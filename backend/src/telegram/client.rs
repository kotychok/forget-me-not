use super::*;
#[derive(Clone)]
pub(super) struct Client {
    http: reqwest::Client,
    base: String,
}
impl Client {
    pub fn new(token: String) -> Result<Self> {
        let (id, secret) = token
            .split_once(':')
            .ok_or(Error::Invalid("Invalid Telegram bot token format"))?;
        if id.is_empty()
            || !id.bytes().all(|b| b.is_ascii_digit())
            || secret.len() < 20
            || !secret
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
        {
            return Err(Error::Invalid("Invalid Telegram bot token format"));
        }
        Self::at(format!("https://api.telegram.org/bot{token}/"))
    }
    pub(super) fn at(base: String) -> Result<Self> {
        let http = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(std::time::Duration::from_secs(10))
            .timeout(std::time::Duration::from_secs(40))
            .build()
            .map_err(|_| Error::Unavailable)?;
        Ok(Self { http, base })
    }
    pub async fn call(&self, method: &str, body: serde_json::Value) -> Result<serde_json::Value> {
        // reqwest errors contain the credential-bearing URL: never display or log them.
        let mut response = self
            .http
            .post(format!("{}{method}", self.base))
            .json(&body)
            .timeout(std::time::Duration::from_secs(if method == "getUpdates" {
                40
            } else {
                10
            }))
            .send()
            .await
            .map_err(|_| Error::Unavailable)?;
        let successful = response.status().is_success();
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| Error::Unavailable)? {
            if bytes.len() + chunk.len() > 2 * 1024 * 1024 {
                return Err(Error::Unavailable);
            }
            bytes.extend_from_slice(&chunk);
        }
        let value: serde_json::Value =
            serde_json::from_slice(&bytes).map_err(|_| Error::Unavailable)?;
        if !successful || value["ok"] != true {
            if let Some(delay) = value["parameters"]["retry_after"].as_u64() {
                return Err(Error::RateLimited(delay.clamp(1, 86400)));
            }
            return Err(Error::Unavailable);
        }
        Ok(value["result"].clone())
    }
}
