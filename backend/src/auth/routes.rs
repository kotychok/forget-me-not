use super::*;
use axum::{
    Extension, Json, Router,
    extract::{Path, Request, State},
    http::StatusCode,
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use tower_sessions::Expiry;

fn error(status: StatusCode, message: &'static str) -> Response {
    (status, Json(serde_json::json!({"error":message}))).into_response()
}
fn storage() -> Response {
    error(
        StatusCode::INTERNAL_SERVER_ERROR,
        "Authentication storage failed",
    )
}
fn unauthorized() -> Response {
    error(StatusCode::UNAUTHORIZED, "Sign in to continue")
}

/// Principal and owner-scoped Store are request-local, never mutable application state.
pub async fn require_user(mut auth: AuthSession, mut request: Request, next: Next) -> Response {
    let Some(user) = auth.user.clone() else {
        let _ = auth.logout().await;
        return unauthorized();
    };
    if request
        .headers()
        .get("x-fmn-owner")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|owner| owner != user.user_id)
    {
        return error(
            StatusCode::UNAUTHORIZED,
            "Account changed; sign in again before continuing",
        );
    }
    if let Some(expected) = request
        .headers()
        .get("x-fmn-installation")
        .and_then(|value| value.to_str().ok())
    {
        match auth.backend.installation_id().await {
            Ok(current) if current != expected => {
                return error(
                    StatusCode::UNAUTHORIZED,
                    "Installation identity changed. Preserve local edits and reload before continuing.",
                );
            }
            Ok(_) => {}
            Err(_) => return storage(),
        }
    }
    let grant: Option<String> = match auth.session.get("grant").await {
        Ok(value) => value,
        Err(_) => return storage(),
    };
    let Some(grant_id) = grant else {
        let _ = auth.logout().await;
        return unauthorized();
    };
    let expiry = match auth.backend.touch_grant(&user, &grant_id).await {
        Ok(Some(expiry)) => expiry,
        Ok(None) => {
            let _ = auth.logout().await;
            return unauthorized();
        }
        Err(_) => return storage(),
    };
    let until = match time::OffsetDateTime::from_unix_timestamp(expiry.min(now() + IDLE_SECONDS)) {
        Ok(value) => value,
        Err(_) => return storage(),
    };
    auth.session.set_expiry(Some(Expiry::AtDateTime(until)));
    request.extensions_mut().insert(Store {
        pool: auth.backend.pool.clone(),
        owner_id: user.user_id.clone(),
    });
    request
        .extensions_mut()
        .insert(Principal { user, grant_id });
    next.run(request).await
}
async fn status(State(backend): State<Backend>) -> Response {
    match configured(&backend.pool).await {
        Ok(configured) => {
            Json(serde_json::json!({"mode":"password","configured":configured})).into_response()
        }
        Err(_) => storage(),
    }
}
async fn login(mut auth: AuthSession, Json(credentials): Json<Credentials>) -> Response {
    let Some(login) = normalized_login(&credentials.login) else {
        return error(StatusCode::UNAUTHORIZED, "Invalid login or password");
    };
    if credentials.password.len() > 1024 {
        return error(StatusCode::UNAUTHORIZED, "Invalid login or password");
    }
    match auth.backend.allow_attempt(&login).await {
        Ok(true) => {}
        Ok(false) => {
            return error(
                StatusCode::TOO_MANY_REQUESTS,
                "Too many sign-in attempts. Try again in 15 minutes.",
            );
        }
        Err(_) => return storage(),
    }
    let user = match auth.authenticate(credentials).await {
        Ok(Some(user)) => user,
        Ok(None) => return error(StatusCode::UNAUTHORIZED, "Invalid login or password"),
        Err(_) => return storage(),
    };
    // Reauthentication in this browser also retires its previous grant. Other devices stay signed in.
    if let Ok(Some(old)) = auth.session.get::<String>("grant").await
        && auth.backend.retire_grant(&old).await.is_err()
    {
        return storage();
    }
    if auth.logout().await.is_err() {
        return storage();
    }
    if auth.session.cycle_id().await.is_err() {
        return storage();
    }
    let grant = match auth.backend.create_grant(&user).await {
        Ok(Some(id)) => id,
        Ok(None) => return unauthorized(),
        Err(_) => return storage(),
    };
    if auth.login(&user).await.is_err() || auth.session.insert("grant", grant).await.is_err() {
        return storage();
    }
    auth.session
        .set_expiry(Some(Expiry::OnInactivity(time::Duration::seconds(
            IDLE_SECONDS,
        ))));
    if auth.backend.cleanup().await.is_err() {
        return storage();
    }
    Json(serde_json::json!({"ownerId":user.user_id,"login":user.login,"role":user.role}))
        .into_response()
}
async fn me(Extension(principal): Extension<Principal>) -> Response {
    Json(serde_json::json!({"ownerId":principal.user.user_id,"login":principal.user.login,"role":principal.user.role,"sessionId":principal.grant_id})).into_response()
}
async fn sessions(
    Extension(principal): Extension<Principal>,
    State(backend): State<Backend>,
) -> Response {
    match backend.sessions(&principal.user).await {
        Ok(grants) => Json(grants).into_response(),
        Err(_) => storage(),
    }
}
async fn revoke(
    Extension(principal): Extension<Principal>,
    State(backend): State<Backend>,
    mut auth: AuthSession,
    Path(id): Path<String>,
) -> Response {
    match backend.revoke(&principal.user, &id).await {
        Ok(_) => {
            if id == principal.grant_id && auth.logout().await.is_err() {
                return storage();
            }
            StatusCode::NO_CONTENT.into_response()
        }
        Err(_) => storage(),
    }
}
async fn logout(
    Extension(principal): Extension<Principal>,
    State(backend): State<Backend>,
    mut auth: AuthSession,
) -> Response {
    if backend
        .revoke(&principal.user, &principal.grant_id)
        .await
        .is_err()
        || auth.logout().await.is_err()
    {
        return storage();
    }
    StatusCode::NO_CONTENT.into_response()
}
async fn revoke_all(
    Extension(principal): Extension<Principal>,
    State(backend): State<Backend>,
    mut auth: AuthSession,
) -> Response {
    if backend.revoke_all(&principal.user).await.is_err() {
        return storage();
    }
    if auth.logout().await.is_err() {
        return storage();
    }
    StatusCode::NO_CONTENT.into_response()
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PasswordChange {
    current_password: String,
    new_password: String,
}
async fn password(
    Extension(principal): Extension<Principal>,
    mut auth: AuthSession,
    Json(change): Json<PasswordChange>,
) -> Response {
    if !valid_password(&change.new_password) || change.current_password.len() > 1024 {
        return error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "New password must contain at least 12 characters and at most 1024 UTF-8 bytes",
        );
    }
    match auth.backend.allow_attempt(&principal.user.login).await {
        Ok(true) => {}
        Ok(false) => {
            return error(
                StatusCode::TOO_MANY_REQUESTS,
                "Too many credential attempts. Try again in 15 minutes.",
            );
        }
        Err(_) => return storage(),
    }
    let verified = match auth
        .authenticate(Credentials {
            login: principal.user.login.clone(),
            password: change.current_password,
        })
        .await
    {
        Ok(Some(user)) if user.auth_version == principal.user.auth_version => user,
        Ok(_) => return error(StatusCode::UNAUTHORIZED, "Current password is incorrect"),
        Err(_) => return storage(),
    };
    let hash = match auth.backend.hash_new(change.new_password).await {
        Ok(hash) => hash,
        Err(_) => return storage(),
    };
    match auth.backend.change_password(&verified, hash).await {
        Ok(true) => {}
        Ok(false) => return unauthorized(),
        Err(_) => return storage(),
    }
    if auth.logout().await.is_err() {
        return storage();
    }
    StatusCode::NO_CONTENT.into_response()
}
pub fn router(backend: Backend) -> Router {
    let protected = Router::new()
        .nest("/admin", crate::accounts::admin_router())
        .route("/me", get(me))
        .route("/sessions", get(sessions))
        .route("/sessions/{id}", axum::routing::delete(revoke))
        .route("/logout", post(logout))
        .route("/logout-all", post(revoke_all))
        .route("/password", post(password))
        .route_layer(middleware::from_fn(require_user));
    Router::new()
        .merge(protected)
        .merge(crate::accounts::public_router())
        .route("/status", get(status))
        .route("/login", post(login))
        .layer(axum::extract::DefaultBodyLimit::max(8 * 1024))
        .with_state(backend)
}
