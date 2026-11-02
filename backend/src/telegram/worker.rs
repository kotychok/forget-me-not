use super::*;
type PendingReply = (i64, i64, String, Option<String>, Option<String>);
impl Telegram {
    pub(super) async fn run(&self) {
        loop {
            if let Err(error) = self.cycle().await {
                let delay = match error {
                    Error::RateLimited(delay) => delay,
                    _ => 10,
                };
                // Never log HTTP errors/URLs, Telegram payloads, chat IDs or bot tokens.
                eprintln!("Telegram polling unavailable; retrying in {delay} seconds.");
                tokio::time::sleep(std::time::Duration::from_secs(delay)).await;
            }
        }
    }
    pub(super) async fn cycle(&self) -> Result<()> {
        let Some(offset) = self.claim().await? else {
            tokio::time::sleep(std::time::Duration::from_secs(10)).await;
            return Ok(());
        };
        self.replies().await?;
        let result = self.client.call("getUpdates",serde_json::json!({"offset":offset,"timeout":25,"limit":25,"allowed_updates":["message"]})).await?;
        let mut updates: Vec<Update> =
            serde_json::from_value(result).map_err(|_| Error::Unavailable)?;
        updates.sort_by_key(|update| update.update_id);
        for update in updates {
            self.process(update).await?;
            self.replies().await?;
        }
        Ok(())
    }
    async fn replies(&self) -> Result<()> {
        sqlx::query("DELETE FROM telegram_links WHERE expires_at<=?")
            .bind(now())
            .execute(&self.pool)
            .await?;
        sqlx::query("DELETE FROM telegram_rates WHERE bucket<?")
            .bind(now() / 60 - 2)
            .execute(&self.pool)
            .await?;
        sqlx::query("DELETE FROM telegram_receipts WHERE created_at<? OR attempts>=8")
            .bind(now() - 86400)
            .execute(&self.pool)
            .await?;
        let rows: Vec<PendingReply> = sqlx::query_as("SELECT update_id,chat_id,reply,user_id,auth_version FROM telegram_receipts WHERE bot_id=? AND retry_at<=? ORDER BY update_id LIMIT 5")
            .bind(self.bot_id).bind(now()).fetch_all(&self.pool).await?;
        for (update, chat, reply, owner, version) in rows {
            let valid = if let Some(owner) = owner {
                sqlx::query_scalar::<_,bool>("SELECT EXISTS(SELECT 1 FROM telegram_connections c JOIN auth_accounts a ON a.user_id=c.user_id WHERE c.bot_id=? AND c.user_id=? AND c.telegram_id=? AND c.auth_version=? AND a.auth_version=c.auth_version AND a.status='active')")
                    .bind(self.bot_id).bind(owner).bind(chat).bind(version).fetch_one(&self.pool).await?
            } else {
                true
            };
            let result = if valid {
                Some(self.client.call("sendMessage",serde_json::json!({"chat_id":chat,"text":reply,"link_preview_options":{"is_disabled":true}})).await)
            } else {
                None
            };
            let sent = matches!(&result, Some(Ok(_)));
            let delay = match result {
                Some(Err(Error::RateLimited(delay))) => delay as i64,
                _ => 60,
            };
            if sent || !valid {
                sqlx::query("DELETE FROM telegram_receipts WHERE bot_id=? AND update_id=?")
                    .bind(self.bot_id)
                    .bind(update)
                    .execute(&self.pool)
                    .await?;
            } else {
                sqlx::query("UPDATE telegram_receipts SET attempts=attempts+1,retry_at=? WHERE bot_id=? AND update_id=?").bind(now()+delay).bind(self.bot_id).bind(update).execute(&self.pool).await?;
            }
        }
        Ok(())
    }
}
