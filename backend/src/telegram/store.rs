use super::*;
use crate::{auth::User, store::Store};
use rand_core::{OsRng, RngCore};
use sqlx::{Sqlite, Transaction};
async fn actor(tx: &mut Transaction<'_, Sqlite>, user: &User) -> Result<()> {
    let updated = sqlx::query("UPDATE auth_accounts SET updated_at=updated_at WHERE user_id=? AND auth_version=? AND status='active'")
        .bind(&user.user_id).bind(&user.auth_version).execute(&mut **tx).await?.rows_affected();
    if updated == 0 {
        return Err(Error::Invalid(
            "Sign in again before changing Telegram settings",
        ));
    }
    Ok(())
}
async fn owned_list(tx: &mut Transaction<'_, Sqlite>, owner: &str, list: &str) -> Result<()> {
    let owned: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM lists WHERE id=? AND owner_id=?)")
            .bind(list)
            .bind(owner)
            .fetch_one(&mut **tx)
            .await?;
    if !owned {
        return Err(Error::Invalid("Choose one of your own existing lists"));
    }
    Ok(())
}
async fn audit(tx: &mut Transaction<'_, Sqlite>, owner: &str, action: &str) -> Result<()> {
    sqlx::query(
        "INSERT INTO account_audit(id,actor_id,target_id,action,created_at) VALUES (?,?,?,?,?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(owner)
    .bind(owner)
    .bind(action)
    .bind(now())
    .execute(&mut **tx)
    .await?;
    Ok(())
}
impl Telegram {
    pub async fn status(&self, user: &User) -> Result<Status> {
        let row: Option<(i64, Option<String>)> = sqlx::query_as("SELECT c.telegram_id,c.list_id FROM telegram_connections c JOIN auth_accounts a ON a.user_id=c.user_id WHERE c.bot_id=? AND c.user_id=? AND c.auth_version=a.auth_version AND a.status='active'")
            .bind(self.bot_id).bind(&user.user_id).fetch_optional(&self.pool).await?;
        Ok(Status {
            enabled: true,
            bot_username: Some(self.username.clone()),
            telegram_id: row.as_ref().map(|r| r.0.to_string()),
            list_id: row.and_then(|r| r.1),
        })
    }
    pub async fn issue_link(&self, user: &User, list: &str) -> Result<String> {
        let mut bytes = [0u8; 32];
        OsRng.fill_bytes(&mut bytes);
        let secret: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
        let mut tx = self.pool.begin().await?;
        actor(&mut tx, user).await?;
        owned_list(&mut tx, &user.user_id, list).await?;
        sqlx::query("DELETE FROM telegram_links WHERE (bot_id=? AND user_id=?) OR expires_at<=?")
            .bind(self.bot_id)
            .bind(&user.user_id)
            .bind(now())
            .execute(&mut *tx)
            .await?;
        sqlx::query("INSERT INTO telegram_links(bot_id,digest,user_id,list_id,auth_version,expires_at) VALUES (?,?,?,?,?,?)")
            .bind(self.bot_id).bind(digest(&secret)).bind(&user.user_id).bind(list).bind(&user.auth_version).bind(now()+600).execute(&mut *tx).await?;
        audit(&mut tx, &user.user_id, "telegram_link_issued").await?;
        tx.commit().await?;
        Ok(format!("https://t.me/{}?start={secret}", self.username))
    }
    pub async fn set_inbox(&self, user: &User, list: &str) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        actor(&mut tx, user).await?;
        owned_list(&mut tx, &user.user_id, list).await?;
        let count = sqlx::query("UPDATE telegram_connections SET list_id=? WHERE bot_id=? AND user_id=? AND auth_version=?")
            .bind(list).bind(self.bot_id).bind(&user.user_id).bind(&user.auth_version).execute(&mut *tx).await?.rows_affected();
        if count == 0 {
            return Err(Error::Invalid("Connect Telegram first"));
        }
        sqlx::query("DELETE FROM telegram_links WHERE bot_id=? AND user_id=?")
            .bind(self.bot_id)
            .bind(&user.user_id)
            .execute(&mut *tx)
            .await?;
        audit(&mut tx, &user.user_id, "telegram_inbox_changed").await?;
        tx.commit().await?;
        Ok(())
    }
    pub async fn disconnect(&self, user: &User) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        actor(&mut tx, user).await?;
        self.disconnect_user(&mut tx, &user.user_id).await?;
        tx.commit().await?;
        Ok(())
    }
    async fn disconnect_user(&self, tx: &mut Transaction<'_, Sqlite>, user: &str) -> Result<()> {
        for table in [
            "telegram_connections",
            "telegram_links",
            "telegram_receipts",
        ] {
            sqlx::query(&format!("DELETE FROM {table} WHERE bot_id=? AND user_id=?"))
                .bind(self.bot_id)
                .bind(user)
                .execute(&mut **tx)
                .await?;
        }
        audit(tx, user, "telegram_disconnected").await?;
        Ok(())
    }
    pub(super) async fn claim(&self) -> Result<Option<i64>> {
        sqlx::query("INSERT INTO telegram_pollers(bot_id,lease_owner,lease_until) VALUES (?,?,?) ON CONFLICT(bot_id) DO UPDATE SET lease_owner=excluded.lease_owner,lease_until=excluded.lease_until WHERE telegram_pollers.lease_owner=excluded.lease_owner OR telegram_pollers.lease_until<=?")
            .bind(self.bot_id).bind(&self.lease).bind(now()+90).bind(now()).execute(&self.pool).await?;
        Ok(sqlx::query_scalar("SELECT next_offset FROM telegram_pollers WHERE bot_id=? AND lease_owner=? AND lease_until>?").bind(self.bot_id).bind(&self.lease).bind(now()).fetch_optional(&self.pool).await?)
    }
    pub(super) async fn process(&self, update: Update) -> Result<()> {
        if update.update_id < 0 || update.update_id == i64::MAX {
            return Err(Error::Invalid("Invalid Telegram update ID"));
        }
        let mut tx = self.pool.begin().await?;
        // Write lock first: account changes, deduplication, append and cursor advance serialize.
        let lease = sqlx::query("UPDATE telegram_pollers SET lease_until=? WHERE bot_id=? AND lease_owner=? AND lease_until>?")
            .bind(now()+90).bind(self.bot_id).bind(&self.lease).bind(now()).execute(&mut *tx).await?.rows_affected();
        if lease == 0 {
            return Err(Error::Unavailable);
        }
        let offset: i64 =
            sqlx::query_scalar("SELECT next_offset FROM telegram_pollers WHERE bot_id=?")
                .bind(self.bot_id)
                .fetch_one(&mut *tx)
                .await?;
        if update.update_id < offset {
            tx.commit().await?;
            return Ok(());
        }
        if let Some(message) = update.message
            && message.chat.kind == "private"
            && message.chat.id > 0
            && message
                .from
                .as_ref()
                .is_some_and(|u| !u.is_bot && u.id == message.chat.id)
        {
            let chat = message.chat.id;
            let mut captured = message.text.clone();
            if let Some(text) = &mut captured
                && !text.starts_with("/start")
                && text != "/help"
                && text != "/disconnect"
            {
                // Telegram text_link entities carry destinations outside the plain text.
                for entity in &message.entities {
                    if entity.kind == "text_link"
                        && let Some(url) = &entity.url
                        && !url.is_empty()
                        && !text.contains(url)
                    {
                        if !text.ends_with('\n') {
                            text.push('\n');
                        }
                        text.push_str(url);
                    }
                }
            }
            let count: i64 = sqlx::query_scalar("INSERT INTO telegram_rates(bot_id,chat_id,bucket,count) VALUES (?,?,?,1) ON CONFLICT(bot_id,chat_id,bucket) DO UPDATE SET count=count+1 RETURNING count")
                    .bind(self.bot_id).bind(chat).bind(now()/60).fetch_one(&mut *tx).await?;
            let reply = if count <= 30 {
                Some(self.message(&mut tx, chat, captured.as_deref()).await?)
            } else if count == 31 {
                Some((
                    "Rate limit reached. Wait a minute before sending more messages.".into(),
                    None,
                    None,
                ))
            } else {
                None
            };
            if let Some((reply, owner, version)) = reply {
                sqlx::query("INSERT INTO telegram_receipts(bot_id,update_id,chat_id,user_id,auth_version,reply,created_at) VALUES (?,?,?,?,?,?,?)")
                        .bind(self.bot_id).bind(update.update_id).bind(chat).bind(owner).bind(version).bind(reply).bind(now()).execute(&mut *tx).await?;
            }
        }
        sqlx::query("UPDATE telegram_pollers SET next_offset=? WHERE bot_id=? AND lease_owner=?")
            .bind(update.update_id + 1)
            .bind(self.bot_id)
            .bind(&self.lease)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(())
    }
    async fn message(
        &self,
        tx: &mut Transaction<'_, Sqlite>,
        chat: i64,
        text: Option<&str>,
    ) -> Result<(String, Option<String>, Option<String>)> {
        let generic = |text: &str| (text.to_string(), None, None);
        let Some(text) = text else {
            return Ok(generic(
                "Only plain text and URLs are supported. Attachments and captions are not imported.",
            ));
        };
        if text == "/disconnect" {
            let owner: Option<String> = sqlx::query_scalar(
                "SELECT user_id FROM telegram_connections WHERE bot_id=? AND telegram_id=?",
            )
            .bind(self.bot_id)
            .bind(chat)
            .fetch_optional(&mut **tx)
            .await?;
            if let Some(owner) = owner {
                self.disconnect_user(tx, &owner).await?;
            }
            return Ok(generic(
                "Telegram disconnected. Reconnect from Account in the app.",
            ));
        }
        if let Some(secret) = text.strip_prefix("/start ") {
            if secret.len() != 64 || !secret.bytes().all(|b| b.is_ascii_hexdigit()) {
                return Ok(generic(
                    "This connection link is invalid or expired. Generate a new one in Account.",
                ));
            }
            let row: Option<(String,String,String)> = sqlx::query_as("SELECT t.user_id,t.list_id,t.auth_version FROM telegram_links t JOIN auth_accounts a ON a.user_id=t.user_id JOIN lists l ON l.id=t.list_id AND l.owner_id=t.user_id WHERE t.bot_id=? AND t.digest=? AND t.expires_at>? AND a.status='active' AND a.auth_version=t.auth_version")
                .bind(self.bot_id).bind(digest(secret)).bind(now()).fetch_optional(&mut **tx).await?;
            let Some((owner, list, version)) = row else {
                return Ok(generic(
                    "This connection link is invalid or expired. Generate a new one in Account.",
                ));
            };
            let taken: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM telegram_connections WHERE bot_id=? AND telegram_id=? AND user_id<>?)").bind(self.bot_id).bind(chat).bind(&owner).fetch_one(&mut **tx).await?;
            if taken {
                return Ok(generic(
                    "This Telegram account is already connected. Send /disconnect before connecting another app account.",
                ));
            }
            sqlx::query("INSERT INTO telegram_connections(bot_id,user_id,telegram_id,list_id,auth_version,linked_at) VALUES (?,?,?,?,?,?) ON CONFLICT(bot_id,user_id) DO UPDATE SET telegram_id=excluded.telegram_id,list_id=excluded.list_id,auth_version=excluded.auth_version,linked_at=excluded.linked_at")
                .bind(self.bot_id).bind(&owner).bind(chat).bind(list).bind(&version).bind(now()).execute(&mut **tx).await?;
            sqlx::query("DELETE FROM telegram_links WHERE bot_id=? AND user_id=?")
                .bind(self.bot_id)
                .bind(&owner)
                .execute(&mut **tx)
                .await?;
            audit(tx, &owner, "telegram_connected").await?;
            return Ok(("Connected. Send a text message or URL to add one item to your Inbox. /disconnect removes this connection.".into(),Some(owner),Some(version)));
        }
        if text == "/start" || text == "/help" || text.trim().is_empty() {
            return Ok(generic(
                "Connect from Account → Telegram in the app, then send text or URLs. Each message becomes one item; line breaks are preserved. /disconnect removes the connection.",
            ));
        }
        let connection: Option<(String,Option<String>,String)> = sqlx::query_as("SELECT c.user_id,c.list_id,c.auth_version FROM telegram_connections c JOIN auth_accounts a ON a.user_id=c.user_id WHERE c.bot_id=? AND c.telegram_id=? AND a.status='active' AND a.auth_version=c.auth_version")
            .bind(self.bot_id).bind(chat).fetch_optional(&mut **tx).await?;
        let Some((owner, list, version)) = connection else {
            return Ok(generic(
                "Connect Telegram from Account in the app first. If your password changed, reconnect.",
            ));
        };
        let Some(list) = list else {
            return Ok(generic(
                "Your Inbox was removed. Choose another list in Account → Telegram.",
            ));
        };
        match Store::append_capture(tx, &owner, &list, text).await {
            Ok(item) => Ok((
                format!(
                    "Saved to your Inbox.\n{}/?list={list}&item={item}",
                    self.origin
                ),
                Some(owner),
                Some(version),
            )),
            Err(crate::error::AppError::Invalid(message)) => Ok(generic(message)),
            Err(crate::error::AppError::NotFound) => Ok(generic(
                "Inbox unavailable. Choose another list in Account → Telegram.",
            )),
            Err(_) => Err(Error::Storage),
        }
    }
}
