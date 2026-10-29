use super::*;
const TOKEN_QUERY: &str = "SELECT t.id,t.user_id,t.purpose,t.digest,t.auth_version,t.expires_at,t.consumed_at,t.revoked_at,a.login,a.auth_version AS current_version,a.disabled_by_admin,a.password_hash,a.activated_at FROM account_tokens t JOIN auth_accounts a ON a.user_id=t.user_id WHERE t.id=?";
async fn admin(tx: &mut Transaction<'_, Sqlite>, actor: &User) -> Result<()> {
    // Write first to serialize authority/last-admin checks with account mutations.
    let valid = sqlx::query("UPDATE auth_accounts SET updated_at=updated_at WHERE user_id=? AND role='admin' AND status='active' AND auth_version=?")
        .bind(&actor.user_id).bind(&actor.auth_version).execute(&mut **tx).await?.rows_affected();
    if valid == 0 {
        return Err(Error::Forbidden);
    }
    Ok(())
}
async fn audit(
    tx: &mut Transaction<'_, Sqlite>,
    actor: &str,
    target: &str,
    action: &str,
) -> Result<()> {
    sqlx::query("INSERT INTO account_audit VALUES (?,?,?,?,?)")
        .bind(Uuid::new_v4().to_string())
        .bind(actor)
        .bind(target)
        .bind(action)
        .bind(now())
        .execute(&mut **tx)
        .await?;
    Ok(())
}
async fn revoke(tx: &mut Transaction<'_, Sqlite>, target: &str) -> Result<()> {
    sqlx::query("DELETE FROM auth_grants WHERE user_id=?")
        .bind(target)
        .execute(&mut **tx)
        .await?;
    sqlx::query("UPDATE account_tokens SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL AND consumed_at IS NULL").bind(now()).bind(target).execute(&mut **tx).await?;
    Ok(())
}
async fn issue(tx: &mut Transaction<'_, Sqlite>, actor: &User, target: &str) -> Result<Issued> {
    let row: Option<(String, Option<i64>, bool)> = sqlx::query_as(
        "SELECT login,activated_at,disabled_by_admin FROM auth_accounts WHERE user_id=?",
    )
    .bind(target)
    .fetch_optional(&mut **tx)
    .await?;
    let (login, activated, disabled) = row.ok_or(Error::NotFound)?;
    if disabled {
        return Err(Error::Invalid("Enable this account before issuing a link"));
    }
    let purpose = if activated.is_some() {
        "reset"
    } else {
        "activate"
    };
    let version = Uuid::new_v4().to_string();
    revoke(tx, target).await?;
    // Admin-issued reset deliberately retires the old password until redemption.
    sqlx::query("UPDATE auth_accounts SET password_hash='',status='disabled',auth_version=?,updated_at=? WHERE user_id=?").bind(&version).bind(now()).bind(target).execute(&mut **tx).await?;
    let (id, token, digest) = new_token();
    let expires_at = now() + TOKEN_LIFETIME;
    sqlx::query("INSERT INTO account_tokens(id,user_id,purpose,digest,auth_version,expires_at) VALUES (?,?,?,?,?,?)")
        .bind(id).bind(target).bind(purpose).bind(digest).bind(version).bind(expires_at).execute(&mut **tx).await?;
    audit(
        tx,
        &actor.user_id,
        target,
        if purpose == "reset" {
            "reset_issued"
        } else {
            "activation_issued"
        },
    )
    .await?;
    Ok(Issued {
        token,
        login,
        purpose: purpose.into(),
        expires_at,
    })
}
impl Backend {
    pub async fn admin_accounts(&self, actor: &User) -> Result<Vec<Account>> {
        // No password or token material is selected for the administration listing.
        let valid: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM auth_accounts WHERE user_id=? AND role='admin' AND status='active' AND auth_version=?)").bind(&actor.user_id).bind(&actor.auth_version).fetch_one(&self.pool).await?;
        if !valid {
            return Err(Error::Forbidden);
        }
        Ok(sqlx::query_as("SELECT a.user_id AS id,a.login,u.display_name,a.role,CASE WHEN a.disabled_by_admin=1 THEN 'disabled' WHEN a.activated_at IS NULL THEN 'pending' WHEN a.password_hash='' THEN 'reset_pending' ELSE a.status END AS status,(SELECT count(*) FROM auth_grants g WHERE g.user_id=a.user_id AND g.auth_version=a.auth_version AND g.expires_at>? AND g.last_seen_at>?) AS active_sessions,(SELECT MAX(expires_at) FROM account_tokens t WHERE t.user_id=a.user_id AND t.auth_version=a.auth_version AND t.consumed_at IS NULL AND t.revoked_at IS NULL AND t.expires_at>?) AS link_expires_at FROM auth_accounts a JOIN users u ON u.id=a.user_id ORDER BY u.created_at,a.login")
            .bind(now()).bind(now()-crate::auth::IDLE_SECONDS).bind(now()).fetch_all(&self.pool).await?)
    }
    pub async fn create_friend(&self, actor: &User, login: &str, name: &str) -> Result<Issued> {
        let login = normalized_login(login).ok_or(Error::Invalid(
            "Login must contain 3–64 ASCII letters, digits, dots, underscores or hyphens",
        ))?;
        let name = name.trim();
        if name.is_empty() || name.chars().count() > 100 || name.chars().any(char::is_control) {
            return Err(Error::Invalid(
                "Display name must contain 1–100 characters without controls",
            ));
        }
        let mut tx = self.pool.begin().await?;
        admin(&mut tx, actor).await?;
        let id = Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO users(id,display_name,created_at) VALUES (?,?,?)")
            .bind(&id)
            .bind(name)
            .bind((time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000) as i64)
            .execute(&mut *tx)
            .await?;
        sqlx::query("INSERT INTO auth_accounts(user_id,login,password_hash,role,status,auth_version,updated_at,activated_at,disabled_by_admin) VALUES (?,?,'','user','disabled',?,?,NULL,0)")
            .bind(&id).bind(login).bind(Uuid::new_v4().to_string()).bind(now()).execute(&mut *tx).await?;
        audit(&mut tx, &actor.user_id, &id, "account_created").await?;
        let result = issue(&mut tx, actor, &id).await?;
        tx.commit().await?;
        Ok(result)
    }
    pub async fn issue_account_link(&self, actor: &User, target: &str) -> Result<Issued> {
        if target == actor.user_id {
            return Err(Error::Invalid(
                "Use Account or local administrator recovery for your own password",
            ));
        }
        let mut tx = self.pool.begin().await?;
        admin(&mut tx, actor).await?;
        let result = issue(&mut tx, actor, target).await?;
        tx.commit().await?;
        Ok(result)
    }
    pub async fn set_account_enabled(
        &self,
        actor: &User,
        target: &str,
        enabled: bool,
    ) -> Result<()> {
        if target == actor.user_id {
            return Err(Error::Invalid(
                "You cannot disable or reactivate your own administrator account",
            ));
        }
        let mut tx = self.pool.begin().await?;
        admin(&mut tx, actor).await?;
        let target_row: Option<(String, String)> =
            sqlx::query_as("SELECT role,status FROM auth_accounts WHERE user_id=?")
                .bind(target)
                .fetch_optional(&mut *tx)
                .await?;
        let (role, status) = target_row.ok_or(Error::NotFound)?;
        if !enabled && role == "admin" && status == "active" {
            let admins: i64 = sqlx::query_scalar(
                "SELECT count(*) FROM auth_accounts WHERE role='admin' AND status='active'",
            )
            .fetch_one(&mut *tx)
            .await?;
            if admins <= 1 {
                return Err(Error::Invalid(
                    "Cannot disable the last active administrator",
                ));
            }
        }
        revoke(&mut tx, target).await?;
        sqlx::query("UPDATE auth_accounts SET disabled_by_admin=?,status=CASE WHEN ?=1 AND password_hash<>'' THEN 'active' ELSE 'disabled' END,auth_version=?,updated_at=? WHERE user_id=?")
            .bind(!enabled).bind(enabled).bind(Uuid::new_v4().to_string()).bind(now()).bind(target).execute(&mut *tx).await?;
        audit(
            &mut tx,
            &actor.user_id,
            target,
            if enabled {
                "account_enabled"
            } else {
                "account_disabled"
            },
        )
        .await?;
        tx.commit().await?;
        Ok(())
    }
    pub async fn revoke_account_sessions(&self, actor: &User, target: &str) -> Result<()> {
        if target == actor.user_id {
            return Err(Error::Invalid("Use Account to sign out your own sessions"));
        }
        let mut tx = self.pool.begin().await?;
        admin(&mut tx, actor).await?;
        let changed =
            sqlx::query("UPDATE auth_accounts SET auth_version=?,updated_at=? WHERE user_id=?")
                .bind(Uuid::new_v4().to_string())
                .bind(now())
                .bind(target)
                .execute(&mut *tx)
                .await?
                .rows_affected();
        if changed == 0 {
            return Err(Error::NotFound);
        }
        revoke(&mut tx, target).await?;
        audit(&mut tx, &actor.user_id, target, "sessions_revoked").await?;
        tx.commit().await?;
        Ok(())
    }
    async fn checked_token(&self, raw: &str) -> Result<TokenRow> {
        let id = token_id(raw).ok_or(Error::Invalid("Link is invalid, expired or already used"))?;
        let row: TokenRow = sqlx::query_as(TOKEN_QUERY)
            .bind(id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or(Error::Invalid("Link is invalid, expired or already used"))?;
        if !row.valid(raw) {
            return Err(Error::Invalid("Link is invalid, expired or already used"));
        }
        Ok(row)
    }
    pub async fn preview_account_link(&self, raw: &str) -> Result<Preview> {
        let row = self.checked_token(raw).await?;
        Ok(Preview {
            login: row.login,
            purpose: row.purpose,
            expires_at: row.expires_at,
        })
    }
    pub async fn redeem_account_link(&self, raw: &str, password: String) -> Result<()> {
        let row = self.checked_token(raw).await?;
        let hash = self.hash_new(password).await.map_err(Error::Invalid)?;
        let mut tx = self.pool.begin().await?;
        sqlx::query("UPDATE auth_accounts SET updated_at=updated_at WHERE user_id=?")
            .bind(&row.user_id)
            .execute(&mut *tx)
            .await?;
        let current: TokenRow = sqlx::query_as(TOKEN_QUERY)
            .bind(&row.id)
            .fetch_one(&mut *tx)
            .await?;
        if !current.valid(raw) {
            return Err(Error::Invalid("Link is invalid, expired or already used"));
        }
        sqlx::query("UPDATE account_tokens SET consumed_at=? WHERE id=?")
            .bind(now())
            .bind(&row.id)
            .execute(&mut *tx)
            .await?;
        revoke(&mut tx, &row.user_id).await?;
        sqlx::query("UPDATE auth_accounts SET password_hash=?,status='active',auth_version=?,activated_at=COALESCE(activated_at,?),updated_at=? WHERE user_id=?")
            .bind(hash).bind(Uuid::new_v4().to_string()).bind(now()).bind(now()).bind(&row.user_id).execute(&mut *tx).await?;
        audit(
            &mut tx,
            &row.user_id,
            &row.user_id,
            if row.purpose == "reset" {
                "password_reset"
            } else {
                "account_activated"
            },
        )
        .await?;
        tx.commit().await?;
        Ok(())
    }
}
