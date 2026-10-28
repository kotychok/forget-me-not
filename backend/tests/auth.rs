use axum::{
    body::Body,
    http::{Request, StatusCode},
    response::Response,
};
use forget_me_not::{
    Store,
    auth::{self, Backend},
    authenticated_app,
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
use uuid::Uuid;
const PASSWORD: &str = "Synthetic password for tests!";
async fn call(
    router: &axum::Router,
    method: &str,
    path: &str,
    cookie: Option<&str>,
    body: Value,
) -> Response {
    let mut req = Request::builder()
        .method(method)
        .uri(path)
        .header("host", "127.0.0.1:3001")
        .header("content-type", "application/json")
        .header("x-fmn-request", "1");
    if let Some(cookie) = cookie {
        req = req.header("cookie", cookie);
    }
    router
        .clone()
        .oneshot(
            req.body(Body::from(serde_json::to_vec(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap()
}
async fn value(response: Response) -> Value {
    serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap()
}
async fn sign_in(router: &axum::Router) -> String {
    let response = call(
        router,
        "POST",
        "/api/auth/login",
        None,
        json!({"login":"OWNER","password":PASSWORD}),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let cookies: Vec<_> = response
        .headers()
        .get_all("set-cookie")
        .iter()
        .map(|v| v.to_str().unwrap().to_owned())
        .collect();
    let cookie = cookies
        .iter()
        .find(|cookie| cookie.starts_with("fmn.sid=") && !cookie.starts_with("fmn.sid=;"))
        .unwrap();
    assert!(cookie.contains("HttpOnly"));
    assert!(cookie.contains("SameSite=Strict"));
    cookie.split(';').next().unwrap().to_owned()
}
async fn setup() -> (tempfile::TempDir, Store, axum::Router) {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(&dir.path().join("auth.sqlite")).await.unwrap();
    auth::bootstrap(&store, "owner", PASSWORD.into(), false)
        .await
        .unwrap();
    let router = authenticated_app(
        store.clone(),
        3001,
        5173,
        std::path::Path::new("missing-assets"),
    )
    .await
    .unwrap();
    (dir, store, router)
}
#[tokio::test]
async fn bootstrap_preserves_owner_and_session_cookie_is_persistent_rotated_and_revocable() {
    let (dir, store, router) = setup().await;
    let list = store.create("Private".into()).await.unwrap();
    assert!(
        auth::bootstrap(&store, "other", PASSWORD.into(), false)
            .await
            .is_err()
    );
    assert_eq!(
        call(&router, "GET", "/api/lists", None, Value::Null)
            .await
            .status(),
        StatusCode::UNAUTHORIZED
    );
    let first = sign_in(&router).await;
    assert_eq!(
        call(&router, "GET", "/api/lists", Some(&first), Value::Null)
            .await
            .status(),
        StatusCode::OK
    );
    let second = call(
        &router,
        "POST",
        "/api/auth/login",
        Some(&first),
        json!({"login":"owner","password":PASSWORD}),
    )
    .await;
    assert_eq!(second.status(), StatusCode::OK);
    let cookie = second
        .headers()
        .get_all("set-cookie")
        .iter()
        .map(|v| v.to_str().unwrap())
        .find(|v| v.starts_with("fmn.sid="))
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_owned();
    assert_ne!(first, cookie);
    assert_eq!(
        call(&router, "GET", "/api/lists", Some(&first), Value::Null)
            .await
            .status(),
        StatusCode::UNAUTHORIZED
    );
    let reopened = Store::open(&dir.path().join("auth.sqlite")).await.unwrap();
    let restart = authenticated_app(reopened, 3001, 5173, std::path::Path::new("missing-assets"))
        .await
        .unwrap();
    let lists = value(call(&restart, "GET", "/api/lists", Some(&cookie), Value::Null).await).await;
    assert_eq!(lists[0]["id"], list.id);
    let me = value(call(&restart, "GET", "/api/auth/me", Some(&cookie), Value::Null).await).await;
    assert_eq!(me["ownerId"], store.owner_id);
    let sessions = value(
        call(
            &restart,
            "GET",
            "/api/auth/sessions",
            Some(&cookie),
            Value::Null,
        )
        .await,
    )
    .await;
    assert_eq!(sessions.as_array().unwrap().len(), 1);
    assert_eq!(
        call(
            &restart,
            "DELETE",
            &format!("/api/auth/sessions/{}", me["sessionId"].as_str().unwrap()),
            Some(&cookie),
            Value::Null
        )
        .await
        .status(),
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        call(&restart, "GET", "/api/lists", Some(&cookie), Value::Null)
            .await
            .status(),
        StatusCode::UNAUTHORIZED
    );
}
#[tokio::test]
async fn authentication_enforces_ownership_csrf_and_account_state() {
    let (_dir, store, router) = setup().await;
    let cookie = sign_in(&router).await;
    let foreign = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO users(id,display_name,created_at) VALUES (?,'Other',0)")
        .bind(&foreign)
        .execute(&store.pool)
        .await
        .unwrap();
    let other = Store {
        pool: store.pool.clone(),
        owner_id: foreign.clone(),
    };
    let foreign_list = other.create("Foreign".into()).await.unwrap();
    for path in [
        format!("/api/lists/{}", foreign_list.id),
        format!("/api/lists/{}/view", foreign_list.id),
        format!("/api/export?listId={}", foreign_list.id),
    ] {
        assert_eq!(
            call(&router, "GET", &path, Some(&cookie), Value::Null)
                .await
                .status(),
            StatusCode::NOT_FOUND
        );
    }
    let request = Request::builder()
        .method("POST")
        .uri("/api/lists")
        .header("host", "127.0.0.1:3001")
        .header("cookie", &cookie)
        .header("content-type", "application/json")
        .body(Body::from(r#"{"title":"CSRF"}"#))
        .unwrap();
    assert_eq!(
        router.clone().oneshot(request).await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
    let request = Request::builder()
        .method("POST")
        .uri("/api/auth/login")
        .header("host", "127.0.0.1:3001")
        .header("origin", "https://foreign.invalid")
        .header("x-fmn-request", "1")
        .header("content-type", "application/json")
        .body(Body::from("{}"))
        .unwrap();
    assert_eq!(
        router.clone().oneshot(request).await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
    sqlx::query("UPDATE auth_accounts SET status='disabled' WHERE user_id=?")
        .bind(&store.owner_id)
        .execute(&store.pool)
        .await
        .unwrap();
    assert_eq!(
        call(&router, "GET", "/api/lists", Some(&cookie), Value::Null)
            .await
            .status(),
        StatusCode::UNAUTHORIZED
    );
}
#[tokio::test]
async fn password_change_revokes_all_devices_and_local_reset_restores_access() {
    let (_dir, store, router) = setup().await;
    let first = sign_in(&router).await;
    let second = sign_in(&router).await;
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/auth/password",
            Some(&first),
            json!({"currentPassword":PASSWORD,"newPassword":"New synthetic password!"})
        )
        .await
        .status(),
        StatusCode::NO_CONTENT
    );
    for cookie in [&first, &second] {
        assert_eq!(
            call(&router, "GET", "/api/lists", Some(cookie), Value::Null)
                .await
                .status(),
            StatusCode::UNAUTHORIZED
        );
    }
    assert_eq!(
        call(
            &router,
            "POST",
            "/api/auth/login",
            None,
            json!({"login":"owner","password":PASSWORD})
        )
        .await
        .status(),
        StatusCode::UNAUTHORIZED
    );
    sqlx::query("UPDATE auth_accounts SET status='disabled' WHERE user_id=?")
        .bind(&store.owner_id)
        .execute(&store.pool)
        .await
        .unwrap();
    auth::bootstrap(&store, "owner", PASSWORD.into(), true)
        .await
        .unwrap();
    let recovered = sign_in(&router).await;
    assert_eq!(
        call(&router, "GET", "/api/lists", Some(&recovered), Value::Null)
            .await
            .status(),
        StatusCode::OK
    );
}
#[tokio::test]
async fn idle_absolute_expiry_and_throttling_are_enforced_server_side() {
    let (_dir, store, router) = setup().await;
    for column in ["last_seen_at", "expires_at"] {
        let cookie = sign_in(&router).await;
        sqlx::query(&format!("UPDATE auth_grants SET {column}=0"))
            .execute(&store.pool)
            .await
            .unwrap();
        assert_eq!(
            call(&router, "GET", "/api/lists", Some(&cookie), Value::Null)
                .await
                .status(),
            StatusCode::UNAUTHORIZED
        );
    }
    let backend = Backend::new(store.pool.clone()).await.unwrap();
    for _ in 0..10 {
        assert!(backend.allow_attempt("bounded").await.unwrap());
    }
    assert!(!backend.allow_attempt("bounded").await.unwrap());
    let stored: String = sqlx::query_scalar("SELECT password_hash FROM auth_accounts")
        .fetch_one(&store.pool)
        .await
        .unwrap();
    assert!(stored.starts_with("$argon2id$"));
    assert!(!stored.contains(PASSWORD));
}

#[tokio::test]
async fn independent_principals_and_expected_owner_prevent_cross_tab_account_replay() {
    let (_dir, store, router) = setup().await;
    let owner_cookie = sign_in(&router).await;
    let owner_list = store.create("Original owner".into()).await.unwrap();
    let other_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO users(id,display_name,created_at) VALUES (?,'Friend',0)")
        .bind(&other_id)
        .execute(&store.pool)
        .await
        .unwrap();
    let hash = auth::hash_password(PASSWORD.into()).await.unwrap();
    sqlx::query("INSERT INTO auth_accounts VALUES (?,'friend',?,'user','active',?,0)")
        .bind(&other_id)
        .bind(hash)
        .bind(Uuid::new_v4().to_string())
        .execute(&store.pool)
        .await
        .unwrap();
    let response = call(
        &router,
        "POST",
        "/api/auth/login",
        None,
        json!({"login":"friend","password":PASSWORD}),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let cookie = response
        .headers()
        .get("set-cookie")
        .unwrap()
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_owned();
    let req = Request::builder()
        .method("POST")
        .uri("/api/lists")
        .header("host", "127.0.0.1:3001")
        .header("x-fmn-request", "1")
        .header("x-fmn-owner", &store.owner_id)
        .header("cookie", &cookie)
        .header("content-type", "application/json")
        .body(Body::from(r#"{"title":"Old workspace replay"}"#))
        .unwrap();
    assert_eq!(
        router.clone().oneshot(req).await.unwrap().status(),
        StatusCode::UNAUTHORIZED
    );
    let other = Store {
        pool: store.pool.clone(),
        owner_id: other_id.clone(),
    };
    assert!(other.lists().await.unwrap().is_empty());
    let response = call(
        &router,
        "POST",
        "/api/lists",
        Some(&cookie),
        json!({"title":"Friend private"}),
    )
    .await;
    assert_eq!(response.status(), StatusCode::CREATED);
    assert_eq!(other.lists().await.unwrap().len(), 1);
    let identity =
        value(call(&router, "GET", "/api/session", Some(&cookie), Value::Null).await).await;
    assert_eq!(identity["ownerId"], other_id);
    assert_eq!(
        call(
            &router,
            "GET",
            &format!("/api/lists/{}", owner_list.id),
            Some(&cookie),
            Value::Null
        )
        .await
        .status(),
        StatusCode::NOT_FOUND
    );
    let owner_lists = value(
        call(
            &router,
            "GET",
            "/api/lists",
            Some(&owner_cookie),
            Value::Null,
        )
        .await,
    )
    .await;
    assert_eq!(owner_lists.as_array().unwrap().len(), 1);
    assert_eq!(owner_lists[0]["id"], owner_list.id);
}
