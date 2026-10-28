use crate::{
    error::{AppError, Result},
    model::*,
    portable::{MAX_FILE_BYTES, Portable},
    store::Store,
};
use axum::{
    Extension, Json, Router,
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
    authenticated: bool,
}
async fn local_only(
    State(state): State<AppState>,
    headers: HeaderMap,
    mut request: axum::extract::Request,
    next: Next,
) -> Response {
    if !state.authenticated {
        match crate::auth::configured(&state.store.pool).await {
            Ok(false) => {}
            Ok(_) => {
                return http_error(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "Accounts are configured; restart in password mode",
                );
            }
            Err(_) => {
                return http_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Access configuration unavailable",
                );
            }
        }
    }
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
    if state.authenticated
        && !matches!(
            *request.method(),
            axum::http::Method::GET | axum::http::Method::HEAD | axum::http::Method::OPTIONS
        )
        && headers.get("x-fmn-request").and_then(|v| v.to_str().ok()) != Some("1")
    {
        return http_error(
            StatusCode::FORBIDDEN,
            "Same-origin application request required",
        );
    }
    if headers.get("sec-fetch-site").and_then(|v| v.to_str().ok()) == Some("cross-site") {
        return http_error(StatusCode::FORBIDDEN, "Cross-site request rejected");
    }
    if !state.authenticated {
        request.extensions_mut().insert(state.store.clone());
    }
    let mut response = next.run(request).await;
    response.headers_mut().insert(
        "cache-control",
        axum::http::HeaderValue::from_static("no-store"),
    );
    response.headers_mut().insert(
        "referrer-policy",
        axum::http::HeaderValue::from_static("no-referrer"),
    );
    response
}
/// Explicit legacy local-only app, used by isolated editor tests and opt-in development mode.
pub fn app(store: Store, backend_port: u16, frontend_port: u16, assets: &FsPath) -> Router {
    build(store, backend_port, frontend_port, assets, None)
}
pub async fn authenticated_app(
    store: Store,
    backend_port: u16,
    frontend_port: u16,
    assets: &FsPath,
) -> Result<Router> {
    let backend = crate::auth::Backend::new(store.pool.clone())
        .await
        .map_err(|_| AppError::Storage)?;
    Ok(build(
        store,
        backend_port,
        frontend_port,
        assets,
        Some(backend),
    ))
}
fn build(
    store: Store,
    backend_port: u16,
    frontend_port: u16,
    assets: &FsPath,
    auth: Option<crate::auth::Backend>,
) -> Router {
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
        authenticated: auth.is_some(),
    };
    let mut api = Router::new()
        .route("/session", get(client_identity))
        .route("/export", get(export_json))
        .route(
            "/transfer/decode",
            axum::routing::post(decode_file)
                .layer(DefaultBodyLimit::max(MAX_FILE_BYTES * 6 + 4096)),
        )
        .route(
            "/transfer/encode",
            axum::routing::post(encode_file).layer(DefaultBodyLimit::max(MAX_FILE_BYTES)),
        )
        .route(
            "/import",
            axum::routing::post(import_json).layer(DefaultBodyLimit::max(MAX_FILE_BYTES)),
        )
        .route(
            "/lists/{id}/view",
            get(get_outline_view).patch(patch_outline_view),
        )
        .route("/lists", get(list_all).post(create_list))
        .route(
            "/lists/{id}",
            get(get_list).put(save_list).delete(delete_list),
        )
        .fallback(|| async { http_error(StatusCode::NOT_FOUND, "API route not found") });
    if auth.is_some() {
        api = api.route_layer(middleware::from_fn(crate::auth::require_user));
    }
    let authenticated = auth.is_some();
    api = api.route(
        "/health",
        get(move || async move {
            Json(serde_json::json!({"mode":if authenticated {"password"} else {"local-only"}}))
        }),
    );
    let mut router = Router::new()
        .nest("/api", api)
        .fallback_service(
            ServeDir::new(assets).not_found_service(ServeFile::new(assets.join("index.html"))),
        )
        .layer(DefaultBodyLimit::max(1024 * 1024))
        .with_state(state.clone());
    if let Some(backend) = auth {
        let session_layer = tower_sessions::SessionManagerLayer::new(
            tower_sessions_sqlx_store::SqliteStore::new(backend.pool.clone()),
        )
        .with_name("fmn.sid")
        .with_http_only(true)
        .with_secure(false)
        .with_same_site(tower_sessions::cookie::SameSite::Strict)
        .with_expiry(tower_sessions::Expiry::OnInactivity(
            time::Duration::seconds(crate::auth::IDLE_SECONDS),
        ));
        router = router
            .nest("/api/auth", crate::auth::router(backend.clone()))
            .layer(axum_login::AuthManagerLayerBuilder::new(backend, session_layer).build());
    } else {
        router = router.route(
            "/api/auth/status",
            get(|| async { Json(serde_json::json!({"mode":"local","configured":true})) }),
        );
    }
    router.layer(middleware::from_fn_with_state(state, local_only))
}
async fn list_all(Extension(store): Extension<Store>) -> Result<Json<Vec<ListSummary>>> {
    Ok(Json(store.lists().await?))
}
async fn create_list(
    Extension(store): Extension<Store>,
    Json(request): Json<CreateList>,
) -> Result<(StatusCode, Json<ListDocument>)> {
    Ok((
        StatusCode::CREATED,
        Json(store.create(request.title).await?),
    ))
}
async fn get_list(
    Extension(store): Extension<Store>,
    Path(id): Path<String>,
) -> Result<Json<ListDocument>> {
    Ok(Json(store.get(&id).await?))
}
async fn save_list(
    Extension(store): Extension<Store>,
    Path(id): Path<String>,
    Json(request): Json<SaveList>,
) -> Result<Json<serde_json::Value>> {
    Ok(Json(
        serde_json::json!({"revision":store.save(&id,request).await?}),
    ))
}
async fn delete_list(
    Extension(store): Extension<Store>,
    Path(id): Path<String>,
    Query(query): Query<DeleteList>,
) -> Result<StatusCode> {
    store.delete(&id, query.base_revision).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExportQuery {
    list_id: Option<String>,
}
async fn export_json(
    Extension(store): Extension<Store>,
    Query(query): Query<ExportQuery>,
) -> Result<Json<Portable>> {
    Ok(Json(store.export_json(query.list_id.as_deref()).await?))
}
async fn import_json(
    Extension(store): Extension<Store>,
    Json(value): Json<serde_json::Value>,
) -> Result<(StatusCode, Json<Vec<ListSummary>>)> {
    let document = Portable::from_value(value)?;
    Ok((
        StatusCode::CREATED,
        Json(store.import_json(document).await?),
    ))
}

async fn client_identity(Extension(store): Extension<Store>) -> Result<Json<ClientIdentity>> {
    Ok(Json(store.identity().await?))
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct DecodeFile {
    format: crate::transfer::Format,
    text: String,
}
async fn decode_file(Json(request): Json<DecodeFile>) -> Result<Json<crate::transfer::Decoded>> {
    Ok(Json(crate::transfer::decode(
        request.format,
        &request.text,
    )?))
}
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct EncodeFile {
    format: crate::transfer::Format,
    document: Portable,
}
async fn encode_file(Json(request): Json<EncodeFile>) -> Result<Json<crate::transfer::Encoded>> {
    Ok(Json(crate::transfer::encode(
        request.format,
        &request.document,
    )?))
}

async fn get_outline_view(
    Extension(store): Extension<Store>,
    Path(id): Path<String>,
) -> Result<Json<OutlineView>> {
    Ok(Json(store.outline_view(&id).await?))
}
async fn patch_outline_view(
    Extension(store): Extension<Store>,
    Path(id): Path<String>,
    Json(request): Json<PatchView>,
) -> Result<Json<OutlineView>> {
    Ok(Json(store.patch_outline_view(&id, request).await?))
}
