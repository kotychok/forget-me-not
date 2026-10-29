use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use forget_me_not::{Store, auth, authenticated_app_with_access, server_config::HttpAccess};
use tower::ServiceExt;

#[test]
fn production_origin_requires_a_canonical_https_hostname() {
    for invalid in [
        "",
        "http://fmn.test",
        "https://localhost",
        "https://127.0.0.1",
        "https://fmn.test/",
        "https://fmn.test:443",
        "https://user@fmn.test",
        "https://fmn.test?x",
        "https://FMN.test",
        "https://a..test",
        "https://-a.test",
        "https://a.test\r\nX: x",
    ] {
        assert!(HttpAccess::production(invalid).is_err(), "{invalid:?}");
    }
    assert!(HttpAccess::production("https://fmn.138.68.187.159.sslip.io").is_ok());
}

#[tokio::test]
async fn production_rejects_foreign_hosts_origins_and_forwarded_header_spoofing() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(&dir.path().join("test.sqlite")).await.unwrap();
    auth::bootstrap(
        &store,
        "owner",
        "Synthetic password for production tests".into(),
        false,
    )
    .await
    .unwrap();
    let app = authenticated_app_with_access(
        store.clone(),
        std::path::Path::new("missing"),
        HttpAccess::production("https://fmn.test").unwrap(),
    )
    .await
    .unwrap();
    for (host, origin, marker, site, expected) in [
        (
            "evil.test",
            "https://fmn.test",
            true,
            "same-origin",
            StatusCode::FORBIDDEN,
        ),
        (
            "127.0.0.1:3001",
            "https://fmn.test",
            true,
            "same-origin",
            StatusCode::FORBIDDEN,
        ),
        (
            "fmn.test",
            "http://fmn.test",
            true,
            "same-origin",
            StatusCode::FORBIDDEN,
        ),
        (
            "fmn.test",
            "https://evil.test",
            true,
            "same-origin",
            StatusCode::FORBIDDEN,
        ),
        (
            "fmn.test",
            "https://fmn.test",
            false,
            "same-origin",
            StatusCode::FORBIDDEN,
        ),
        (
            "fmn.test",
            "https://fmn.test",
            true,
            "cross-site",
            StatusCode::FORBIDDEN,
        ),
        (
            "fmn.test",
            "https://fmn.test",
            true,
            "same-origin",
            StatusCode::OK,
        ),
    ] {
        let mut request = Request::builder()
            .method("POST")
            .uri("/api/auth/status")
            .header("host", host)
            .header("origin", origin)
            .header("sec-fetch-site", site)
            .header("forwarded", "host=fmn.test;proto=https")
            .header("x-forwarded-host", "fmn.test")
            .header("x-forwarded-proto", "https");
        if marker {
            request = request.header("x-fmn-request", "1");
        }
        // Status uses GET; a valid POST reaches the router and returns 405.
        let expected = if expected == StatusCode::OK {
            StatusCode::METHOD_NOT_ALLOWED
        } else {
            expected
        };
        assert_eq!(
            app.clone()
                .oneshot(request.body(Body::empty()).unwrap())
                .await
                .unwrap()
                .status(),
            expected
        );
    }
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/login")
                .header("host", "fmn.test")
                .header("origin", "https://fmn.test")
                .header("x-fmn-request", "1")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"login":"owner","password":"Synthetic password for production tests"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let cookie = response
        .headers()
        .get_all("set-cookie")
        .iter()
        .map(|v| v.to_str().unwrap())
        .find(|v| v.starts_with("__Host-fmn.sid="))
        .unwrap();
    assert!(cookie.contains("Secure"));
    assert!(cookie.contains("HttpOnly"));
    assert!(cookie.contains("SameSite=Strict"));
    assert!(cookie.contains("Path=/"));
    assert!(!cookie.contains("Domain="));
    let cookie = cookie.split(';').next().unwrap();
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/lists")
                .header("host", "fmn.test")
                .header("cookie", cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    store.pool.close().await;
}

#[test]
fn invalid_production_config_fails_before_creating_a_database() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("must-not-exist.sqlite");
    for (mode, origin) in [
        ("local", "https://fmn.test"),
        ("password", ""),
        ("password", "http://fmn.test"),
    ] {
        let mut command = std::process::Command::new(env!("CARGO_BIN_EXE_forget-me-not"));
        command
            .env("FMN_ENV", "production")
            .env("FMN_AUTH_MODE", mode)
            .env("FMN_DB_PATH", &db)
            .env_remove("FMN_PUBLIC_ORIGIN");
        if !origin.is_empty() {
            command.env("FMN_PUBLIC_ORIGIN", origin);
        }
        let output = command.output().unwrap();
        assert!(!output.status.success());
        assert!(!db.exists());
    }
}

#[tokio::test]
async fn readiness_reports_an_unavailable_database() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(&dir.path().join("test.sqlite")).await.unwrap();
    let app = authenticated_app_with_access(
        store.clone(),
        std::path::Path::new("missing"),
        HttpAccess::production("https://fmn.test").unwrap(),
    )
    .await
    .unwrap();
    store.pool.close().await;
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/health")
                .header("host", "fmn.test")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
}
