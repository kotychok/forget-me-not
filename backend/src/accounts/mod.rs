mod routes;
mod store;
use crate::auth::{Backend, User, normalized_login, now};
use rand_core::{OsRng, RngCore};
pub use routes::{admin_router, public_router};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, Sqlite, Transaction};
use subtle::ConstantTimeEq;
use uuid::Uuid;
const TOKEN_LIFETIME: i64 = 24 * 60 * 60;
#[derive(Debug)]
pub enum Error {
    Invalid(&'static str),
    Forbidden,
    NotFound,
    Conflict,
    Storage,
}
impl From<sqlx::Error> for Error {
    fn from(error: sqlx::Error) -> Self {
        if matches!(&error, sqlx::Error::Database(db) if db.is_unique_violation()) {
            Self::Conflict
        } else {
            Self::Storage
        }
    }
}
type Result<T> = std::result::Result<T, Error>;
#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub login: String,
    pub display_name: String,
    pub role: String,
    pub status: String,
    pub active_sessions: i64,
    pub link_expires_at: Option<i64>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Issued {
    pub token: String,
    pub login: String,
    pub purpose: String,
    pub expires_at: i64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub login: String,
    pub purpose: String,
    pub expires_at: i64,
}
#[derive(FromRow)]
struct TokenRow {
    id: String,
    user_id: String,
    purpose: String,
    digest: Vec<u8>,
    auth_version: String,
    expires_at: i64,
    consumed_at: Option<i64>,
    revoked_at: Option<i64>,
    login: String,
    current_version: String,
    disabled_by_admin: bool,
    password_hash: String,
    activated_at: Option<i64>,
}
impl TokenRow {
    fn valid(&self, raw: &str) -> bool {
        self.digest
            .as_slice()
            .ct_eq(Sha256::digest(raw.as_bytes()).as_slice())
            .into()
            && self.auth_version == self.current_version
            && !self.disabled_by_admin
            && self.expires_at > now()
            && self.consumed_at.is_none()
            && self.revoked_at.is_none()
            && self.password_hash.is_empty()
            && ((self.purpose == "activate" && self.activated_at.is_none())
                || (self.purpose == "reset" && self.activated_at.is_some()))
    }
}
fn token_id(raw: &str) -> Option<&str> {
    let (id, secret) = raw.split_once('.')?;
    (Uuid::parse_str(id).is_ok_and(|value| value.to_string() == id)
        && secret.len() == 64
        && secret.bytes().all(|ch| ch.is_ascii_hexdigit()))
    .then_some(id)
}
fn new_token() -> (String, String, Vec<u8>) {
    let id = Uuid::new_v4().to_string();
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    let raw = format!(
        "{id}.{}",
        bytes
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    );
    let digest = Sha256::digest(raw.as_bytes()).to_vec();
    (id, raw, digest)
}
