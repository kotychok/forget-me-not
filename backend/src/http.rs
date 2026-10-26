use crate::{
    error::{AppError, Result},
    model::*,
    portable::{MAX_FILE_BYTES, Portable},
    store::Store,
};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
};
use std::path::Path as FsPath;
use tower_http::services::{ServeDir, ServeFile};

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            Self::NotFound => (StatusCode::NOT_FOUND, "List not found".to_owned()),
            Self::Conflict => (
                StatusCode::CONFLICT,
                "List changed on the server".to_owned(),
            ),
            Self::Invalid(message) => (StatusCode::UNPROCESSABLE_ENTITY, message.to_owned()),
            Self::InvalidImport(message) => (StatusCode::UNPROCESSABLE_ENTITY, message),
            Self::Corrupt(message) => (StatusCode::INTERNAL_SERVER_ERROR, message.to_owned()),
            Self::Storage => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Storage operation failed".to_owned(),
            ),
        };
        (status, Json(serde_json::json!({"error": message}))).into_response()
    }
}
fn http_error(status: StatusCode, message: &'static str) -> Response {
    (status, Json(serde_json::json!({"error":message}))).into_response()
}

#[derive(Clone)]
struct AppState {
    store: Store,
    origins: Vec<String>,
    authorities: Vec<String>,
}
async fn local_only(
    State(state): State<AppState>,
    headers: HeaderMap,
    request: axum::extract::Request,
    next: Next,
) -> Response {
    let host = headers.get("host").and_then(|value| value.to_str().ok());
    if !host.is_some_and(|host| state.authorities.iter().any(|allowed| allowed == host)) {
        return http_error(StatusCode::FORBIDDEN, "Only local access is supported");
    }
    if let Some(origin) = headers.get("origin")
        && !origin
            .to_str()
            .ok()
            .is_some_and(|origin| state.origins.iter().any(|allowed| allowed == origin))
    {
        return http_error(StatusCode::FORBIDDEN, "Origin is not allowed");
    }
    next.run(request).await
}
pub fn app(store: Store, backend_port: u16, frontend_port: u16, assets: &FsPath) -> Router {
    let authorities: Vec<String> = [backend_port, frontend_port]
        .iter()
        .flat_map(|port| [format!("127.0.0.1:{port}"), format!("localhost:{port}")])
        .collect();
    let state = AppState {
        store,
        origins: authorities
            .iter()
            .map(|host| format!("http://{host}"))
            .collect(),
        authorities,
    };
    let api = Router::new()
        .route(
            "/health",
            get(|| async { Json(serde_json::json!({"mode":"local-only"})) }),
        )
        .route("/export", get(export_json))
        .route(
            "/import",
            axum::routing::post(import_json).layer(DefaultBodyLimit::max(MAX_FILE_BYTES)),
        )
        .route("/lists", get(list_all).post(create_list))
        .route(
            "/lists/{id}",
            get(get_list).put(save_list).delete(delete_list),
        )
        .fallback(|| async { http_error(StatusCode::NOT_FOUND, "API route not found") });
    Router::new()
        .nest("/api", api)
        .fallback_service(
            ServeDir::new(assets).not_found_service(ServeFile::new(assets.join("index.html"))),
        )
        .layer(DefaultBodyLimit::max(1024 * 1024))
        .layer(middleware::from_fn_with_state(state.clone(), local_only))
        .with_state(state)
}
async fn list_all(State(state): State<AppState>) -> Result<Json<Vec<ListSummary>>> {
    Ok(Json(state.store.lists().await?))
}
async fn create_list(
    State(state): State<AppState>,
    Json(request): Json<CreateList>,
) -> Result<(StatusCode, Json<ListDocument>)> {
    Ok((
        StatusCode::CREATED,
        Json(state.store.create(request.title).await?),
    ))
}
async fn get_list(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<ListDocument>> {
    Ok(Json(state.store.get(&id).await?))
}
async fn save_list(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<SaveList>,
) -> Result<Json<serde_json::Value>> {
    Ok(Json(
        serde_json::json!({"revision":state.store.save(&id,request).await?}),
    ))
}
async fn delete_list(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<DeleteList>,
) -> Result<StatusCode> {
    state.store.delete(&id, query.base_revision).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExportQuery {
    list_id: Option<String>,
}
async fn export_json(
    State(state): State<AppState>,
    Query(query): Query<ExportQuery>,
) -> Result<Json<Portable>> {
    Ok(Json(
        state.store.export_json(query.list_id.as_deref()).await?,
    ))
}
async fn import_json(
    State(state): State<AppState>,
    Json(value): Json<serde_json::Value>,
) -> Result<(StatusCode, Json<Vec<ListSummary>>)> {
    let document = Portable::from_value(value)?;
    Ok((
        StatusCode::CREATED,
        Json(state.store.import_json(document).await?),
    ))
}
