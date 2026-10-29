use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use axum_login::AuthnBackend;
use forget_me_not::{
    Document, SaveList, Store,
    auth::{self, Backend},
    authenticated_app, maintenance,
};
use serde_json::json;
use tower::ServiceExt;
use uuid::Uuid;
const PASSWORD: &str = "Synthetic backup password!";
async fn cookie(router: &axum::Router) -> String {
    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/login")
                .header("host", "127.0.0.1:3001")
                .header("content-type", "application/json")
                .header("x-fmn-request", "1")
                .body(Body::from(
                    json!({"login":"owner","password":PASSWORD}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    response
        .headers()
        .get("set-cookie")
        .unwrap()
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_owned()
}
#[tokio::test]
async fn wal_snapshot_restores_content_credentials_and_view_but_retires_sessions_links_and_draft_scope()
 {
    let dir = tempfile::Builder::new()
        .prefix("fmn quote ' backup ")
        .tempdir()
        .unwrap();
    let source = dir.path().join("source.sqlite");
    let backup = dir.path().join("snapshot ' $().sqlite");
    let restored = dir.path().join("restored.sqlite");
    let store = Store::open(&source).await.unwrap();
    auth::bootstrap(&store, "owner", PASSWORD.into(), false)
        .await
        .unwrap();
    let backend = Backend::new(store.pool.clone()).await.unwrap();
    let user = backend.get_user(&store.owner_id).await.unwrap().unwrap();
    let link = backend
        .create_friend(&user, "friend", "Friend")
        .await
        .unwrap();
    let list = store.create("Snapshot".into()).await.unwrap();
    let parent = Uuid::new_v4().to_string();
    let child = Uuid::new_v4().to_string();
    let document: Document=serde_json::from_value(json!({"id":list.id,"title":"Snapshot","nodes":[{"id":parent,"kind":"task","text":"**Original**","note":"Note","tags":["work"],"dueDate":"2028-02-29","completed":false,"children":[{"id":child,"kind":"item","text":"Child","completed":false,"children":[]}]}]})).unwrap();
    store
        .save(
            &list.id,
            SaveList {
                base_revision: 0,
                document,
            },
        )
        .await
        .unwrap();
    let patch = serde_json::from_value(
        json!({"baseRevision":0,"changes":[{"itemId":parent,"collapsed":true}]}),
    )
    .unwrap();
    store.patch_outline_view(&list.id, patch).await.unwrap();
    let original = store.get(&list.id).await.unwrap();
    let identity = store.identity().await.unwrap();
    let router = authenticated_app(store.clone(), 3001, 5173, std::path::Path::new("missing"))
        .await
        .unwrap();
    let old_cookie = cookie(&router).await;
    assert!(
        std::fs::metadata(source.with_extension("sqlite-wal"))
            .unwrap()
            .len()
            > 0
    );
    let report = maintenance::backup(&source, &backup).await.unwrap();
    assert_eq!(report.items, 2);
    assert_eq!(report.lists, 1);
    let bytes = std::fs::read(&backup).unwrap();
    store.create("After snapshot".into()).await.unwrap();
    maintenance::restore(&backup, &restored).await.unwrap();
    assert_eq!(std::fs::read(&backup).unwrap(), bytes);
    let recovered = Store::open(&restored).await.unwrap();
    assert_eq!(recovered.owner_id, store.owner_id);
    assert_ne!(
        recovered.identity().await.unwrap().server_id,
        identity.server_id
    );
    assert_eq!(
        serde_json::to_value(recovered.get(&list.id).await.unwrap()).unwrap(),
        serde_json::to_value(original).unwrap()
    );
    assert_eq!(recovered.lists().await.unwrap().len(), 1);
    assert_eq!(
        recovered
            .outline_view(&list.id)
            .await
            .unwrap()
            .collapsed_item_ids,
        vec![parent]
    );
    let recovered_backend = Backend::new(recovered.pool.clone()).await.unwrap();
    assert!(
        recovered_backend
            .preview_account_link(&link.token)
            .await
            .is_err()
    );
    assert!(backend.preview_account_link(&link.token).await.is_ok());
    let router = authenticated_app(
        recovered.clone(),
        3001,
        5173,
        std::path::Path::new("missing"),
    )
    .await
    .unwrap();
    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/lists")
                .header("host", "127.0.0.1:3001")
                .header("cookie", old_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let fresh_cookie = cookie(&router).await;
    for (installation, status) in [
        (&identity.server_id, StatusCode::UNAUTHORIZED),
        (
            &recovered.identity().await.unwrap().server_id,
            StatusCode::OK,
        ),
    ] {
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/lists")
                    .header("host", "127.0.0.1:3001")
                    .header("cookie", &fresh_cookie)
                    .header("x-fmn-installation", installation)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), status);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(&backup).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
}
#[tokio::test]
async fn verification_and_failed_publication_do_not_create_or_overwrite_destinations() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("source.sqlite");
    let missing = dir.path().join("missing.sqlite");
    let target = dir.path().join("target.sqlite");
    assert!(maintenance::backup(&missing, &target).await.is_err());
    assert!(!missing.exists());
    assert!(!target.exists());
    let store = Store::open(&source).await.unwrap();
    std::fs::write(&target, b"Keep this file").unwrap();
    assert!(maintenance::backup(&source, &target).await.is_err());
    assert!(maintenance::restore(&source, &target).await.is_err());
    assert_eq!(std::fs::read(&target).unwrap(), b"Keep this file");
    std::fs::remove_file(&target).unwrap();
    std::fs::write(dir.path().join("target.sqlite-wal"), b"Sidecar").unwrap();
    assert!(maintenance::restore(&source, &target).await.is_err());
    assert!(!target.exists());
    sqlx::query("UPDATE _sqlx_migrations SET checksum=X'00' WHERE version=(SELECT MAX(version) FROM _sqlx_migrations)").execute(&store.pool).await.unwrap();
    assert!(maintenance::verify(&source).await.is_err());
    assert!(maintenance::backup(&source, &missing).await.is_err());
    assert!(!missing.exists());
    std::fs::write(&missing, b"Not SQLite").unwrap();
    assert!(maintenance::verify(&missing).await.is_err());
}
#[tokio::test]
async fn snapshots_during_atomic_writes_never_mix_revisions() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("source.sqlite");
    let backup = dir.path().join("backup.sqlite");
    let store = Store::open(&source).await.unwrap();
    let list = store.create("Concurrent".into()).await.unwrap();
    let mut document: Document=serde_json::from_value(json!({"id":list.id,"title":"Concurrent","nodes":[{"id":Uuid::new_v4().to_string(),"kind":"item","text":"0","completed":false,"children":[]},{"id":Uuid::new_v4().to_string(),"kind":"item","text":"0","completed":false,"children":[]}]})).unwrap();
    store
        .save(
            &list.id,
            SaveList {
                base_revision: 0,
                document: document.clone(),
            },
        )
        .await
        .unwrap();
    let writer = store.clone();
    let id = list.id.clone();
    let writing = tokio::spawn(async move {
        for index in 1..=25 {
            document.nodes[0].text = index.to_string();
            document.nodes[1].text = index.to_string();
            writer
                .save(
                    &id,
                    SaveList {
                        base_revision: index,
                        document: document.clone(),
                    },
                )
                .await
                .unwrap();
            tokio::task::yield_now().await;
        }
    });
    maintenance::backup(&source, &backup).await.unwrap();
    writing.await.unwrap();
    let copy = Store::open(&backup).await.unwrap();
    let document = copy.get(&list.id).await.unwrap();
    assert_eq!(document.nodes[0].text, document.nodes[1].text);
    assert_eq!(
        document.revision,
        document.nodes[0].text.parse::<i64>().unwrap() + 1
    );
}

#[tokio::test]
async fn older_supported_snapshot_is_upgraded_only_in_the_restored_copy() {
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    let dir = tempfile::tempdir().unwrap();
    let old = dir.path().join("old");
    std::fs::create_dir(&old).unwrap();
    for file in std::fs::read_dir(concat!(env!("CARGO_MANIFEST_DIR"), "/migrations")).unwrap() {
        let file = file.unwrap();
        if file
            .file_name()
            .to_string_lossy()
            .starts_with("20261029000800")
        {
            continue;
        }
        std::fs::copy(file.path(), old.join(file.file_name())).unwrap();
    }
    let source = dir.path().join("old.sqlite");
    let copy = dir.path().join("restored.sqlite");
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            SqliteConnectOptions::new()
                .filename(&source)
                .create_if_missing(true)
                .foreign_keys(true),
        )
        .await
        .unwrap();
    sqlx::migrate::Migrator::new(old.as_path())
        .await
        .unwrap()
        .run(&pool)
        .await
        .unwrap();
    let owner = Uuid::new_v4().to_string();
    let list = Uuid::new_v4().to_string();
    let hash = auth::hash_password(PASSWORD.into()).await.unwrap();
    sqlx::query("INSERT INTO users VALUES (?,'Owner',1)")
        .bind(&owner)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO local_identity VALUES (1,?)")
        .bind(&owner)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO lists VALUES (?,?,'Old list',0,7,1,2)")
        .bind(&list)
        .bind(&owner)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO auth_accounts VALUES (?,'owner',?,'admin','active','old-version',2)")
        .bind(&owner)
        .bind(hash)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        maintenance::verify(&source)
            .await
            .unwrap()
            .pending_migrations,
        1
    );
    let report = maintenance::restore(&source, &copy).await.unwrap();
    assert_eq!(report.pending_migrations, 0);
    assert_eq!(
        maintenance::verify(&source)
            .await
            .unwrap()
            .pending_migrations,
        1
    );
    let restored = Store::open(&copy).await.unwrap();
    assert_eq!(restored.owner_id, owner);
    assert_eq!(restored.get(&list).await.unwrap().revision, 7);
    let backend = Backend::new(restored.pool.clone()).await.unwrap();
    assert!(
        backend
            .authenticate(auth::Credentials {
                login: "owner".into(),
                password: PASSWORD.into()
            })
            .await
            .unwrap()
            .is_some()
    );
}

#[test]
fn cli_verification_never_initializes_the_configured_database() {
    let dir = tempfile::tempdir().unwrap();
    let configured = dir.path().join("must-not-be-created.sqlite");
    let invalid = dir.path().join("invalid.sqlite");
    std::fs::write(&invalid, b"bad").unwrap();
    let status = std::process::Command::new(env!("CARGO_BIN_EXE_forget-me-not"))
        .env("FMN_DB_PATH", &configured)
        .arg("--verify-backup")
        .arg(&invalid)
        .output()
        .unwrap();
    assert!(!status.status.success());
    assert!(!configured.exists());
    assert_eq!(std::fs::read(&invalid).unwrap(), b"bad");
}
