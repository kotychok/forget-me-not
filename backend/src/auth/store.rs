//! SQLite transactions for accounts, sessions and throttling; no HTTP types.
use super::*;
use tower_sessions::ExpiredDeletion;
use tower_sessions_sqlx_store::SqliteStore;

pub async fn configured(pool: &SqlitePool) -> Result<bool, sqlx::Error> {
    Ok(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM auth_accounts")
            .fetch_one(pool)
            .await?
            > 0,
    )
}
impl Backend {
    pub(super) async fn installation_id(&self) -> Result<String, sqlx::Error> {
        sqlx::query_scalar("SELECT id FROM installation WHERE singleton=1")
            .fetch_one(&self.pool)
            .await
    }
    // Reserve attempts durably before hashing. A global cap bounds unknown-login buckets too.
    pub async fn allow_attempt(&self, login: &str) -> Result<bool, sqlx::Error> {
        let time = now();
        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM auth_attempts WHERE started_at<=?")
            .bind(time - 900)
            .execute(&mut *tx)
            .await?;
        for (bucket, limit) in [("global".to_owned(), 100), (format!("login:{login}"), 10)] {
            let attempts: i64 = sqlx::query_scalar("INSERT INTO auth_attempts(bucket,started_at,attempts) VALUES (?,?,1) ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1 RETURNING attempts").bind(bucket).bind(time).fetch_one(&mut *tx).await?;
            if attempts > limit {
                tx.commit().await?;
                return Ok(false);
            }
        }
        tx.commit().await?;
        Ok(true)
    }
    pub async fn create_grant(&self, user: &User) -> Result<Option<String>, sqlx::Error> {
        let id = Uuid::new_v4().to_string();
        let time = now();
        sqlx::query_scalar("INSERT INTO auth_grants(id,user_id,auth_version,created_at,last_seen_at,expires_at) SELECT ?,user_id,auth_version,?,?,? FROM auth_accounts WHERE user_id=? AND status='active' AND auth_version=? RETURNING id")
            .bind(id).bind(time).bind(time).bind(time+ABSOLUTE_SECONDS).bind(&user.user_id).bind(&user.auth_version).fetch_optional(&self.pool).await
    }
    pub async fn touch_grant(&self, user: &User, id: &str) -> Result<Option<i64>, sqlx::Error> {
        let time = now();
        sqlx::query_scalar("UPDATE auth_grants SET last_seen_at=? WHERE id=? AND user_id=? AND auth_version=? AND expires_at>? AND last_seen_at>? AND EXISTS(SELECT 1 FROM auth_accounts WHERE user_id=? AND status='active' AND auth_version=?) RETURNING expires_at")
            .bind(time).bind(id).bind(&user.user_id).bind(&user.auth_version).bind(time).bind(time-IDLE_SECONDS).bind(&user.user_id).bind(&user.auth_version).fetch_optional(&self.pool).await
    }
    pub async fn change_password(&self, user: &User, hash: String) -> Result<bool, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        let changed = sqlx::query("UPDATE auth_accounts SET password_hash=?,auth_version=?,updated_at=? WHERE user_id=? AND status='active' AND auth_version=?").bind(hash).bind(Uuid::new_v4().to_string()).bind(now()).bind(&user.user_id).bind(&user.auth_version).execute(&mut *tx).await?.rows_affected();
        if changed > 0 {
            sqlx::query("DELETE FROM auth_grants WHERE user_id=?")
                .bind(&user.user_id)
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
        Ok(changed > 0)
    }
    pub(super) async fn account_by_login(&self, login: &str) -> Result<Option<User>, sqlx::Error> {
        sqlx::query_as("SELECT user_id,login,role,password_hash,auth_version FROM auth_accounts WHERE login=? AND status='active'").bind(login).fetch_optional(&self.pool).await
    }
    pub(super) async fn account_by_id(&self, id: &str) -> Result<Option<User>, sqlx::Error> {
        sqlx::query_as("SELECT user_id,login,role,password_hash,auth_version FROM auth_accounts WHERE user_id=? AND status='active'").bind(id).fetch_optional(&self.pool).await
    }
    pub(super) async fn retire_grant(&self, id: &str) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM auth_grants WHERE id=?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
    pub(super) async fn sessions(&self, user: &User) -> Result<Vec<Grant>, sqlx::Error> {
        sqlx::query_as("SELECT id,created_at,last_seen_at,expires_at FROM auth_grants WHERE user_id=? AND expires_at>? AND last_seen_at>? ORDER BY created_at DESC,id").bind(&user.user_id).bind(now()).bind(now()-IDLE_SECONDS).fetch_all(&self.pool).await
    }
    pub(super) async fn revoke(&self, user: &User, id: &str) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM auth_grants WHERE id=? AND user_id=?")
            .bind(id)
            .bind(&user.user_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
    pub(super) async fn revoke_all(&self, user: &User) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("UPDATE auth_accounts SET auth_version=?,updated_at=? WHERE user_id=?")
            .bind(Uuid::new_v4().to_string())
            .bind(now())
            .bind(&user.user_id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM auth_grants WHERE user_id=?")
            .bind(&user.user_id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await
    }
    pub(super) async fn cleanup(&self) -> Result<(), ()> {
        // Use the library's timestamp encoding for its records.
        SqliteStore::new(self.pool.clone())
            .delete_expired()
            .await
            .map_err(|_| ())?;
        sqlx::query("DELETE FROM auth_grants WHERE expires_at<=? OR last_seen_at<=?")
            .bind(now())
            .bind(now() - IDLE_SECONDS)
            .execute(&self.pool)
            .await
            .map_err(|_| ())?;
        Ok(())
    }
}
pub(super) async fn bootstrap_account(
    store: &Store,
    login: String,
    hash: String,
    reset: bool,
) -> Result<(), String> {
    let mut tx = store.pool.begin().await.map_err(|_| "Storage failed")?;
    let changed = if reset {
        sqlx::query("UPDATE auth_accounts SET password_hash=?,auth_version=?,updated_at=?,status='active',disabled_by_admin=0,activated_at=COALESCE(activated_at,updated_at) WHERE login=? AND user_id=? AND role='admin'")
            .bind(hash).bind(Uuid::new_v4().to_string()).bind(now()).bind(login).bind(&store.owner_id).execute(&mut *tx).await
    } else {
        sqlx::query("INSERT INTO auth_accounts(user_id,login,password_hash,role,status,auth_version,updated_at,activated_at) SELECT ?,?,?,'admin','active',?,?,? WHERE NOT EXISTS(SELECT 1 FROM auth_accounts)")
            .bind(&store.owner_id).bind(login).bind(hash).bind(Uuid::new_v4().to_string()).bind(now()).bind(now()).execute(&mut *tx).await
    }.map_err(|_| "Account could not be configured")?.rows_affected();
    if changed != 1 {
        return Err("Bootstrap requires no existing accounts; reset requires the existing local administrator login".into());
    }
    sqlx::query("DELETE FROM auth_grants WHERE user_id=?")
        .bind(&store.owner_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| "Storage failed")?;
    if reset {
        sqlx::query("DELETE FROM auth_attempts")
            .execute(&mut *tx)
            .await
            .map_err(|_| "Storage failed")?;
    }
    tx.commit().await.map_err(|_| "Storage failed")?;
    Ok(())
}
