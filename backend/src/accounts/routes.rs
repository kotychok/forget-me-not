use super::*;
use crate::auth::Principal;
use axum::{
    Extension, Json, Router,
    extract::{Path, Request, State},
    http::StatusCode,
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
impl IntoResponse for Error {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            Self::Invalid(message) => (StatusCode::UNPROCESSABLE_ENTITY, message),
            Self::Forbidden => (StatusCode::FORBIDDEN, "Administrator access required"),
            Self::NotFound => (StatusCode::NOT_FOUND, "Account not found"),
            Self::Conflict => (StatusCode::CONFLICT, "Login is already in use"),
            Self::Storage => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Account operation failed",
            ),
        };
        (status, Json(serde_json::json!({"error":message}))).into_response()
    }
}
async fn require_admin(
    Extension(actor): Extension<Principal>,
    request: Request,
    next: Next,
) -> Response {
    if actor.user.role != "admin" {
        return Error::Forbidden.into_response();
    }
    next.run(request).await
}
async fn list(
    State(backend): State<Backend>,
    Extension(actor): Extension<Principal>,
) -> Result<Json<Vec<Account>>> {
    Ok(Json(backend.admin_accounts(&actor.user).await?))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Create {
    login: String,
    display_name: String,
}
async fn create(
    State(backend): State<Backend>,
    Extension(actor): Extension<Principal>,
    Json(input): Json<Create>,
) -> Result<(StatusCode, Json<Issued>)> {
    Ok((
        StatusCode::CREATED,
        Json(
            backend
                .create_friend(&actor.user, &input.login, &input.display_name)
                .await?,
        ),
    ))
}
async fn link(
    State(backend): State<Backend>,
    Extension(actor): Extension<Principal>,
    Path(id): Path<String>,
) -> Result<Json<Issued>> {
    Ok(Json(backend.issue_account_link(&actor.user, &id).await?))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Enabled {
    enabled: bool,
}
async fn enabled(
    State(backend): State<Backend>,
    Extension(actor): Extension<Principal>,
    Path(id): Path<String>,
    Json(input): Json<Enabled>,
) -> Result<StatusCode> {
    backend
        .set_account_enabled(&actor.user, &id, input.enabled)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
async fn revoke(
    State(backend): State<Backend>,
    Extension(actor): Extension<Principal>,
    Path(id): Path<String>,
) -> Result<StatusCode> {
    backend.revoke_account_sessions(&actor.user, &id).await?;
    Ok(StatusCode::NO_CONTENT)
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Link {
    token: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Redeem {
    token: String,
    password: String,
}
async fn limit(backend: &Backend, raw: &str) -> Option<Response> {
    let bucket = token_id(raw).unwrap_or("invalid-link");
    match backend.allow_attempt(&format!("access:{bucket}")).await {
        Ok(true) => None,
        Ok(false) => Some((
            StatusCode::TOO_MANY_REQUESTS,
            Json(serde_json::json!({"error":"Too many access attempts. Try again in 15 minutes."})),
        )
            .into_response()),
        Err(_) => Some(Error::Storage.into_response()),
    }
}
async fn preview(State(backend): State<Backend>, Json(input): Json<Link>) -> Response {
    if let Some(response) = limit(&backend, &input.token).await {
        return response;
    }
    match backend.preview_account_link(&input.token).await {
        Ok(info) => Json(info).into_response(),
        Err(error) => error.into_response(),
    }
}
async fn redeem(State(backend): State<Backend>, Json(input): Json<Redeem>) -> Response {
    if let Some(response) = limit(&backend, &input.token).await {
        return response;
    }
    match backend
        .redeem_account_link(&input.token, input.password)
        .await
    {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => error.into_response(),
    }
}
pub fn admin_router() -> Router<Backend> {
    Router::new()
        .route("/users", get(list).post(create))
        .route("/users/{id}/link", post(link))
        .route("/users/{id}/enabled", post(enabled))
        .route("/users/{id}/revoke", post(revoke))
        .route_layer(middleware::from_fn(require_admin))
}
pub fn public_router() -> Router<Backend> {
    Router::new()
        .route("/access/info", post(preview))
        .route("/access/redeem", post(redeem))
}
