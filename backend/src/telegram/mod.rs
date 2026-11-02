//! Optional private-chat capture. No browser API tokens or Telegram credentials in content exports.
mod client;
mod routes;
mod store;
#[cfg(test)]
mod tests;
mod worker;
use crate::auth::now;
pub use routes::router;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use std::sync::Arc;
use uuid::Uuid;

#[derive(Clone)]
pub struct Telegram {
    pool: SqlitePool,
    bot_id: i64,
    username: String,
    origin: String,
    lease: String,
    client: client::Client,
}
#[derive(Deserialize, Clone)]
pub struct Update {
    pub update_id: i64,
    pub message: Option<Message>,
}
#[derive(Deserialize, Clone)]
pub struct Message {
    pub chat: Chat,
    pub from: Option<Sender>,
    pub text: Option<String>,
    #[serde(default)]
    pub entities: Vec<Entity>,
}
#[derive(Deserialize, Clone)]
pub struct Entity {
    #[serde(rename = "type")]
    pub kind: String,
    pub url: Option<String>,
}
#[derive(Deserialize, Clone)]
pub struct Chat {
    pub id: i64,
    #[serde(rename = "type")]
    pub kind: String,
}
#[derive(Deserialize, Clone)]
pub struct Sender {
    pub id: i64,
    #[serde(default)]
    pub is_bot: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    enabled: bool,
    bot_username: Option<String>,
    telegram_id: Option<String>,
    list_id: Option<String>,
}
#[derive(Debug)]
pub enum Error {
    Invalid(&'static str),
    Storage,
    Unavailable,
    RateLimited(u64),
}
pub type Result<T> = std::result::Result<T, Error>;
impl From<sqlx::Error> for Error {
    fn from(_: sqlx::Error) -> Self {
        Self::Storage
    }
}
fn digest(secret: &str) -> Vec<u8> {
    Sha256::digest(secret.as_bytes()).to_vec()
}
impl Telegram {
    pub async fn connect(pool: SqlitePool, token: String, origin: String) -> Result<Arc<Self>> {
        let client = client::Client::new(token)?;
        let me = client.call("getMe", serde_json::json!({})).await?;
        let bot_id = me["id"]
            .as_i64()
            .filter(|id| *id > 0)
            .ok_or(Error::Unavailable)?;
        let username = me["username"]
            .as_str()
            .filter(|name| {
                !name.is_empty() && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
            })
            .ok_or(Error::Unavailable)?
            .to_string();
        let webhook = client.call("getWebhookInfo", serde_json::json!({})).await?;
        if webhook["url"].as_str() != Some("") {
            return Err(Error::Invalid(
                "Remove the bot's existing webhook before enabling long polling",
            ));
        }
        Ok(Arc::new(Self {
            pool,
            bot_id,
            username,
            origin,
            lease: Uuid::new_v4().to_string(),
            client,
        }))
    }
    pub fn start(self: &Arc<Self>) -> tokio::task::JoinHandle<()> {
        let service = self.clone();
        tokio::spawn(async move {
            service.run().await;
        })
    }
    pub async fn release(&self) {
        let _ = sqlx::query("UPDATE telegram_pollers SET lease_until=0,lease_owner='' WHERE bot_id=? AND lease_owner=?").bind(self.bot_id).bind(&self.lease).execute(&self.pool).await;
    }
}
