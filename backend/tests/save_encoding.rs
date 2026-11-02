use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use forget_me_not::Store;
use serde_json::json;
use std::io::Write;
use tower::ServiceExt;
fn gzip(bytes: &[u8]) -> Vec<u8> {
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    encoder.write_all(bytes).unwrap();
    encoder.finish().unwrap()
}
async fn put(app: &axum::Router, id: &str, body: Vec<u8>, encoding: Option<&str>) -> StatusCode {
    let mut req = Request::builder()
        .method("PUT")
        .uri(format!("/api/lists/{id}"))
        .header("host", "127.0.0.1:3001")
        .header("content-type", "application/json")
        .header("content-length", body.len());
    if let Some(value) = encoding {
        req = req.header("content-encoding", value);
    }
    app.clone()
        .oneshot(req.body(Body::from(body)).unwrap())
        .await
        .unwrap()
        .status()
}
#[tokio::test]
async fn gzip_and_plain_snapshots_share_atomic_revision_checks_and_limits() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(&dir.path().join("encoding.sqlite"))
        .await
        .unwrap();
    let doc = store.create("Before".into()).await.unwrap();
    let app = forget_me_not::app(store.clone(), 3001, 5173, std::path::Path::new("missing"));
    let body = json!({"baseRevision":0,"document":{"id":doc.id,"title":"Нотатки 🌿","nodes":[]}});
    let encoded = gzip(&serde_json::to_vec(&body).unwrap());
    assert_eq!(
        put(&app, &doc.id, encoded.clone(), Some("gzip")).await,
        StatusCode::OK
    );
    assert_eq!(store.get(&doc.id).await.unwrap().title, "Нотатки 🌿");
    assert_eq!(
        put(&app, &doc.id, encoded, Some("gzip")).await,
        StatusCode::CONFLICT
    );
    let body = json!({"baseRevision":1,"document":{"id":doc.id,"title":"Plain client","nodes":[]}});
    assert_eq!(
        put(&app, &doc.id, serde_json::to_vec(&body).unwrap(), None).await,
        StatusCode::OK
    );
    let huge = gzip(&vec![b' '; 1024 * 1024 + 1]);
    assert!(huge.len() < 8192);
    assert_eq!(
        put(&app, &doc.id, huge, Some("gzip")).await,
        StatusCode::PAYLOAD_TOO_LARGE
    );
    assert_eq!(
        put(&app, &doc.id, vec![0; 1024 * 1024 + 1], Some("gzip")).await,
        StatusCode::PAYLOAD_TOO_LARGE
    );
    assert_ne!(
        put(&app, &doc.id, b"broken gzip".to_vec(), Some("gzip")).await,
        StatusCode::OK
    );
    assert_eq!(
        put(&app, &doc.id, b"unsupported".to_vec(), Some("br")).await,
        StatusCode::UNSUPPORTED_MEDIA_TYPE
    );
    assert_eq!(store.get(&doc.id).await.unwrap().revision, 2);
    store.pool.close().await;
}
#[tokio::test]
async fn compressed_requests_still_require_authentication_and_csrf() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(&dir.path().join("auth.sqlite")).await.unwrap();
    forget_me_not::auth::bootstrap(
        &store,
        "owner",
        "Synthetic compression password!".into(),
        false,
    )
    .await
    .unwrap();
    let doc = store.create("Protected".into()).await.unwrap();
    let app = forget_me_not::authenticated_app(
        store.clone(),
        3001,
        5173,
        std::path::Path::new("missing"),
    )
    .await
    .unwrap();
    let body = gzip(
        &serde_json::to_vec(
            &json!({"baseRevision":0,"document":{"id":doc.id,"title":"No","nodes":[]}}),
        )
        .unwrap(),
    );
    assert_eq!(
        put(&app, &doc.id, body, Some("gzip")).await,
        StatusCode::FORBIDDEN
    );
    assert_eq!(store.get(&doc.id).await.unwrap().revision, 0);
    let unauthenticated = app
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri(format!("/api/lists/{}", doc.id))
                .header("host", "127.0.0.1:3001")
                .header("content-type", "application/json")
                .header("content-encoding", "gzip")
                .header("x-fmn-request", "1")
                .body(Body::from(gzip(b"{}")))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(unauthenticated.status(), StatusCode::UNAUTHORIZED);

    store.pool.close().await;
}
