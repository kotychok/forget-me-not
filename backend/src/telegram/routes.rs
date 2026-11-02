use super::*;
use crate::auth::Principal;
use axum::{
    Extension, Json, Router,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, patch, post},
};
impl IntoResponse for Error {
    fn into_response(self) -> Response {
        let (status, text) = match self {
            Error::Invalid(text) => (StatusCode::UNPROCESSABLE_ENTITY, text),
            Error::Storage => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Telegram operation failed",
            ),
            Error::Unavailable | Error::RateLimited(_) => (
                StatusCode::SERVICE_UNAVAILABLE,
                "Telegram is not configured or temporarily unavailable",
            ),
        };
        (status, Json(serde_json::json!({"error":text}))).into_response()
    }
}
async fn status(
    Extension(actor): Extension<Principal>,
    service: Option<Extension<Arc<Telegram>>>,
) -> Result<Json<Status>> {
    Ok(Json(match service {
        Some(Extension(service)) => service.status(&actor.user).await?,
        None => Status {
            enabled: false,
            bot_username: None,
            telegram_id: None,
            list_id: None,
        },
    }))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Inbox {
    list_id: String,
}
async fn link(
    Extension(actor): Extension<Principal>,
    service: Option<Extension<Arc<Telegram>>>,
    Json(input): Json<Inbox>,
) -> Result<Json<serde_json::Value>> {
    let service = service.ok_or(Error::Unavailable)?.0;
    let url = service.issue_link(&actor.user, &input.list_id).await?;
    Ok(Json(serde_json::json!({"url":url,"expiresIn":600})))
}
async fn inbox(
    Extension(actor): Extension<Principal>,
    service: Option<Extension<Arc<Telegram>>>,
    Json(input): Json<Inbox>,
) -> Result<StatusCode> {
    service
        .ok_or(Error::Unavailable)?
        .0
        .set_inbox(&actor.user, &input.list_id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
async fn disconnect(
    Extension(actor): Extension<Principal>,
    service: Option<Extension<Arc<Telegram>>>,
) -> Result<StatusCode> {
    service
        .ok_or(Error::Unavailable)?
        .0
        .disconnect(&actor.user)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
pub fn router<S: Clone + Send + Sync + 'static>() -> Router<S> {
    Router::new()
        .route("/", get(status).delete(disconnect))
        .route("/link", post(link))
        .route("/inbox", patch(inbox))
}
