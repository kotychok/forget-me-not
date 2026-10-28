mod routes;
mod store;
use crate::store::Store;
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier, password_hash::SaltString};
use axum_login::{AuthUser, AuthnBackend};
use rand_core::OsRng;
pub use routes::{require_user, router};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use std::sync::Arc;
pub use store::configured;
use tokio::sync::Semaphore;
use uuid::Uuid;

pub const IDLE_SECONDS: i64 = 7 * 24 * 60 * 60;
pub const ABSOLUTE_SECONDS: i64 = 30 * 24 * 60 * 60;
pub fn now() -> i64 {
    time::OffsetDateTime::now_utc().unix_timestamp()
}
#[derive(Clone, FromRow)]
pub struct User {
    pub user_id: String,
    pub login: String,
    pub role: String,
    password_hash: String,
    auth_version: String,
}
impl std::fmt::Debug for User {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("User")
            .field("id", &self.user_id)
            .finish_non_exhaustive()
    }
}
impl AuthUser for User {
    type Id = String;
    fn id(&self) -> String {
        self.user_id.clone()
    }
    fn session_auth_hash(&self) -> &[u8] {
        self.auth_version.as_bytes()
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Credentials {
    pub login: String,
    pub password: String,
}
#[derive(Clone)]
pub struct Backend {
    pub pool: SqlitePool,
    hash_slots: Arc<Semaphore>,
    dummy_hash: Arc<String>,
}
pub type AuthSession = axum_login::AuthSession<Backend>;
#[derive(Clone)]
pub struct Principal {
    pub user: User,
    pub grant_id: String,
}
#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Grant {
    pub id: String,
    pub created_at: i64,
    pub last_seen_at: i64,
    pub expires_at: i64,
}

pub fn normalized_login(login: &str) -> Option<String> {
    let value = login.to_ascii_lowercase();
    (value.len() >= 3
        && value.len() <= 64
        && value
            .bytes()
            .all(|ch| ch.is_ascii_alphanumeric() || b"._-".contains(&ch)))
    .then_some(value)
}
pub fn valid_password(password: &str) -> bool {
    password.chars().count() >= 12 && password.len() <= 1024
}
pub async fn hash_password(password: String) -> Result<String, &'static str> {
    hash_with_permit(password, None).await
}
async fn hash_with_permit(
    password: String,
    permit: Option<tokio::sync::OwnedSemaphorePermit>,
) -> Result<String, &'static str> {
    if !valid_password(&password) {
        return Err("Password must contain at least 12 characters and at most 1024 UTF-8 bytes");
    }
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        Argon2::default()
            .hash_password(password.as_bytes(), &SaltString::generate(&mut OsRng))
            .map(|hash| hash.to_string())
            .map_err(|_| "Password hashing failed")
    })
    .await
    .map_err(|_| "Password hashing failed")?
}
impl Backend {
    pub async fn new(pool: SqlitePool) -> Result<Self, &'static str> {
        Ok(Self {
            pool,
            hash_slots: Arc::new(Semaphore::new(2)),
            dummy_hash: Arc::new(hash_password(Uuid::new_v4().to_string()).await?),
        })
    }
    pub async fn hash_new(&self, password: String) -> Result<String, &'static str> {
        let permit = self
            .hash_slots
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| "Hashing unavailable")?;
        hash_with_permit(password, Some(permit)).await
    }
}
impl AuthnBackend for Backend {
    type User = User;
    type Credentials = Credentials;
    type Error = sqlx::Error;
    async fn authenticate(&self, credentials: Credentials) -> Result<Option<User>, sqlx::Error> {
        let login = normalized_login(&credentials.login).unwrap_or_default();
        let user = self.account_by_login(&login).await?;
        let hash = user
            .as_ref()
            .map(|user| user.password_hash.clone())
            .unwrap_or_else(|| self.dummy_hash.as_ref().clone());
        let password = credentials.password;
        let permit = self
            .hash_slots
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| sqlx::Error::PoolClosed)?;
        let valid = tokio::task::spawn_blocking(move || {
            let _permit = permit;
            PasswordHash::new(&hash).is_ok_and(|hash| {
                Argon2::default()
                    .verify_password(password.as_bytes(), &hash)
                    .is_ok()
            })
        })
        .await
        .map_err(|_| sqlx::Error::WorkerCrashed)?;
        Ok(if valid { user } else { None })
    }
    async fn get_user(&self, id: &String) -> Result<Option<User>, sqlx::Error> {
        self.account_by_id(id).await
    }
}
/// Explicit local operation: attach credentials to the existing local owner, never reassign lists.
pub async fn bootstrap(
    store: &Store,
    login: &str,
    password: String,
    reset: bool,
) -> Result<(), String> {
    let login = normalized_login(login)
        .ok_or("Login must contain 3–64 ASCII letters, digits, '.', '_' or '-'")?;
    let hash = hash_password(password).await.map_err(str::to_owned)?;
    store::bootstrap_account(store, login, hash, reset).await
}
