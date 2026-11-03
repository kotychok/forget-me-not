use super::*;
use crate::{
    Store,
    auth::{self, Backend, User},
    model::{Document, SaveList},
};
use axum_login::AuthnBackend;
use std::path::Path;

async fn setup() -> (tempfile::TempDir, Store, User, Arc<Telegram>, String) {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(&dir.path().join("telegram.sqlite"))
        .await
        .unwrap();
    auth::bootstrap(
        &store,
        "owner",
        "Synthetic Telegram test password!".into(),
        false,
    )
    .await
    .unwrap();
    let backend = Backend::new(store.pool.clone()).await.unwrap();
    let user = backend.get_user(&store.owner_id).await.unwrap().unwrap();
    let list = store.create("Inbox".into()).await.unwrap();
    let service = Arc::new(Telegram {
        pool: store.pool.clone(),
        bot_id: 123,
        username: "fmn_test_bot".into(),
        origin: "https://fmn.test".into(),
        lease: Uuid::new_v4().to_string(),
        client: client::Client::at("http://127.0.0.1:9/".into()).unwrap(),
    });
    service.claim().await.unwrap().unwrap();
    (dir, store, user, service, list.id)
}
fn update(id: i64, chat: i64, text: Option<&str>) -> Update {
    Update {
        update_id: id,
        message: Some(Message {
            chat: Chat {
                id: chat,
                kind: "private".into(),
            },
            from: Some(Sender {
                id: chat,
                is_bot: false,
            }),
            text: text.map(str::to_string),
            entities: vec![],
        }),
    }
}
async fn link(service: &Telegram, user: &User, list: &str, chat: i64, id: i64) -> String {
    let url = service.issue_link(user, list).await.unwrap();
    let secret = url.split("start=").nth(1).unwrap();
    assert_eq!(secret.len(), 64);
    service
        .process(update(id, chat, Some(&format!("/start {secret}"))))
        .await
        .unwrap();
    url
}
async fn other_user(store: &Store) -> User {
    let id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO users VALUES (?,'Other',0)")
        .bind(&id)
        .execute(&store.pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO auth_accounts(user_id,login,password_hash,role,status,auth_version,updated_at,activated_at,disabled_by_admin) SELECT ?,'other',password_hash,'user','active','other-version',0,0,0 FROM auth_accounts WHERE user_id=?")
        .bind(&id).bind(&store.owner_id).execute(&store.pool).await.unwrap();
    Backend::new(store.pool.clone())
        .await
        .unwrap()
        .get_user(&id)
        .await
        .unwrap()
        .unwrap()
}
#[tokio::test]
async fn capture_is_literal_atomic_deduplicated_and_restarts_at_a_durable_offset() {
    let (_dir, store, user, service, list) = setup().await;
    let issued = link(&service, &user, &list, 99, 1).await;
    let plain = "A thought\nhttps://example.org/?a=1&b=2";
    service.process(update(2, 99, Some(plain))).await.unwrap();
    service.process(update(2, 99, Some(plain))).await.unwrap();
    let content = store.get(&list).await.unwrap();
    assert_eq!(content.revision, 1);
    assert_eq!(content.nodes.len(), 1);
    assert_eq!(content.nodes[0].text, plain);
    assert_eq!(content.nodes[0].kind, "item");
    let stale = store
        .save(
            &list,
            SaveList {
                base_revision: 0,
                document: Document {
                    archived: false,
                    id: list.clone(),
                    title: "Inbox".into(),
                    nodes: vec![],
                },
            },
        )
        .await;
    assert!(matches!(stale, Err(crate::error::AppError::Conflict)));
    let receipts: Vec<String> = sqlx::query_scalar("SELECT reply FROM telegram_receipts")
        .fetch_all(&store.pool)
        .await
        .unwrap();
    assert!(
        receipts
            .iter()
            .any(|reply| reply.contains(&format!("item={}", content.nodes[0].id)))
    );
    assert!(
        !receipts
            .iter()
            .any(|reply| reply.contains(plain) || reply.contains(&issued))
    );
    let mut restart = service.as_ref().clone();
    restart.lease = Uuid::new_v4().to_string();
    assert_eq!(restart.claim().await.unwrap(), None);
    service.release().await;
    assert_eq!(restart.claim().await.unwrap(), Some(3));
    restart
        .process(update(2, 99, Some("duplicate after restart")))
        .await
        .unwrap();
    assert_eq!(store.get(&list).await.unwrap().nodes.len(), 1);
    store.pool.close().await;
}
#[tokio::test]
async fn links_are_owned_expiring_single_use_private_and_cannot_steal_another_connection() {
    let (_dir, store, user, service, list) = setup().await;
    let other = other_user(&store).await;
    assert!(service.issue_link(&other, &list).await.is_err());
    let url = service.issue_link(&user, &list).await.unwrap();
    let payload = format!("/start {}", url.split("start=").nth(1).unwrap());
    let mut group = update(1, 99, Some(&payload));
    group.message.as_mut().unwrap().chat.kind = "group".into();
    service.process(group).await.unwrap();
    assert!(service.status(&user).await.unwrap().telegram_id.is_none());
    service
        .process(update(2, 99, Some(&payload)))
        .await
        .unwrap();
    service
        .process(update(3, 100, Some(&payload)))
        .await
        .unwrap();
    assert_eq!(
        service.status(&user).await.unwrap().telegram_id,
        Some("99".into())
    );
    let other_store = Store {
        pool: store.pool.clone(),
        owner_id: other.user_id.clone(),
    };
    let other_list = other_store.create("Other Inbox".into()).await.unwrap();
    link(&service, &other, &other_list.id, 99, 4).await;
    assert!(service.status(&other).await.unwrap().telegram_id.is_none());
    assert!(service.set_inbox(&user, &other_list.id).await.is_err());
    service
        .process(update(5, 99, Some("/disconnect")))
        .await
        .unwrap();
    link(&service, &other, &other_list.id, 99, 6).await;
    assert!(service.status(&user).await.unwrap().telegram_id.is_none());
    assert_eq!(
        service.status(&other).await.unwrap().telegram_id,
        Some("99".into())
    );
    let expired = service.issue_link(&user, &list).await.unwrap();
    sqlx::query("UPDATE telegram_links SET expires_at=0")
        .execute(&store.pool)
        .await
        .unwrap();
    service
        .process(update(
            7,
            100,
            Some(&format!(
                "/start {}",
                expired.split("start=").nth(1).unwrap()
            )),
        ))
        .await
        .unwrap();
    assert!(service.status(&user).await.unwrap().telegram_id.is_none());
    store.pool.close().await;
}
#[tokio::test]
async fn disabled_or_rotated_accounts_and_missing_inboxes_never_capture() {
    let (_dir, store, user, service, list) = setup().await;
    link(&service, &user, &list, 99, 1).await;
    sqlx::query("UPDATE auth_accounts SET status='disabled' WHERE user_id=?")
        .bind(&user.user_id)
        .execute(&store.pool)
        .await
        .unwrap();
    service
        .process(update(2, 99, Some("not captured")))
        .await
        .unwrap();
    sqlx::query("UPDATE auth_accounts SET status='active',auth_version='rotated' WHERE user_id=?")
        .bind(&user.user_id)
        .execute(&store.pool)
        .await
        .unwrap();
    service
        .process(update(3, 99, Some("still not captured")))
        .await
        .unwrap();
    assert_eq!(store.get(&list).await.unwrap().nodes.len(), 0);
    assert!(service.status(&user).await.unwrap().telegram_id.is_none());
    let refreshed = Backend::new(store.pool.clone())
        .await
        .unwrap()
        .get_user(&user.user_id)
        .await
        .unwrap()
        .unwrap();
    link(&service, &refreshed, &list, 99, 4).await;
    store.delete(&list, 0).await.unwrap();
    service
        .process(update(5, 99, Some("missing Inbox")))
        .await
        .unwrap();
    let next = store.create("New Inbox".into()).await.unwrap();
    service.set_inbox(&refreshed, &next.id).await.unwrap();
    service
        .process(update(6, 99, Some("works again")))
        .await
        .unwrap();
    assert_eq!(store.get(&next.id).await.unwrap().nodes.len(), 1);
    service.disconnect(&refreshed).await.unwrap();
    service
        .process(update(7, 99, Some("disconnected")))
        .await
        .unwrap();
    assert_eq!(store.get(&next.id).await.unwrap().nodes.len(), 1);
    store.pool.close().await;
}
#[tokio::test]
async fn rate_limits_and_unsupported_media_do_not_write_items() {
    let (_dir, store, user, service, list) = setup().await;
    link(&service, &user, &list, 99, 1).await;
    service.process(update(2, 99, None)).await.unwrap();
    let mut forged = update(3, 99, Some("forged"));
    forged.message.as_mut().unwrap().from.as_mut().unwrap().id = 100;
    service.process(forged).await.unwrap();
    for id in 4..=34 {
        service
            .process(update(id, 99, Some("one message")))
            .await
            .unwrap();
    }
    // Connection and unsupported media consumed two of the 30/minute slots.
    assert_eq!(store.get(&list).await.unwrap().nodes.len(), 28);
    let limited: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM telegram_receipts WHERE reply LIKE 'Rate limit reached%'",
    )
    .fetch_one(&store.pool)
    .await
    .unwrap();
    assert_eq!(limited, 1);
    store.pool.close().await;
}
#[tokio::test]
async fn full_list_is_rejected_without_advancing_content_revision() {
    let (_dir, store, user, service, list) = setup().await;
    link(&service, &user, &list, 99, 1).await;
    let mut doc = store.get(&list).await.unwrap();
    doc.nodes = (0..5000)
        .map(|_| crate::model::Item {
            id: Uuid::new_v4().to_string(),
            kind: "item".into(),
            text: String::new(),
            note: String::new(),
            tags: vec![],
            due_date: None,
            completed: false,
            children: vec![],
        })
        .collect();
    store
        .save(
            &list,
            SaveList {
                base_revision: 0,
                document: Document {
                    archived: false,
                    id: list.clone(),
                    title: doc.title,
                    nodes: doc.nodes,
                },
            },
        )
        .await
        .unwrap();
    service
        .process(update(2, 99, Some("too many")))
        .await
        .unwrap();
    assert_eq!(store.get(&list).await.unwrap().revision, 1);
    assert_eq!(service.claim().await.unwrap(), Some(3));
    store.pool.close().await;
}
#[tokio::test]
async fn restore_disconnects_integrations_and_retires_pending_links_and_replies() {
    let (dir, store, user, service, list) = setup().await;
    link(&service, &user, &list, 99, 1).await;
    service.issue_link(&user, &list).await.unwrap();
    let snapshot = dir.path().join("backup.sqlite");
    crate::maintenance::backup(&dir.path().join("telegram.sqlite"), &snapshot)
        .await
        .unwrap();
    let target = dir.path().join("restored.sqlite");
    crate::maintenance::restore(&snapshot, &target)
        .await
        .unwrap();
    let restored = Store::open(&target).await.unwrap();
    for table in [
        "telegram_connections",
        "telegram_links",
        "telegram_receipts",
        "telegram_rates",
    ] {
        let count: i64 = sqlx::query_scalar(&format!("SELECT count(*) FROM {table}"))
            .fetch_one(&restored.pool)
            .await
            .unwrap();
        assert_eq!(count, 0);
    }
    restored.pool.close().await;
    store.pool.close().await;
}
#[tokio::test]
async fn http_routes_require_sessions_csrf_and_owned_targets_and_hide_bot_credentials() {
    use axum::{
        Extension,
        body::Body,
        http::{Request, StatusCode},
    };
    use http_body_util::BodyExt;
    use tower::ServiceExt;
    let (_dir, store, _user, service, list) = setup().await;
    let router = crate::authenticated_app(store.clone(), 3001, 5173, Path::new("missing"))
        .await
        .unwrap()
        .layer(Extension(service));
    let login = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/login")
                .header("host", "127.0.0.1:3001")
                .header("content-type", "application/json")
                .header("x-fmn-request", "1")
                .body(Body::from(
                    r#"{"login":"owner","password":"Synthetic Telegram test password!"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let cookie = login
        .headers()
        .get("set-cookie")
        .unwrap()
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string();
    for (authenticated, marker, expected) in [
        (false, true, StatusCode::UNAUTHORIZED),
        (true, false, StatusCode::FORBIDDEN),
        (true, true, StatusCode::OK),
    ] {
        let mut req = Request::builder()
            .method("POST")
            .uri("/api/telegram/link")
            .header("host", "127.0.0.1:3001")
            .header("content-type", "application/json");
        if authenticated {
            req = req.header("cookie", &cookie);
        }
        if marker {
            req = req.header("x-fmn-request", "1");
        }
        let response = router
            .clone()
            .oneshot(
                req.body(Body::from(serde_json::json!({"listId":list}).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), expected);
    }
    let response = router
        .oneshot(
            Request::builder()
                .uri("/api/telegram")
                .header("host", "127.0.0.1:3001")
                .header("cookie", cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let json: serde_json::Value =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(json["enabled"], true);
    assert!(json.get("token").is_none());
    store.pool.close().await;
}
#[tokio::test]
async fn worker_uses_durable_receipts_with_a_local_mock_and_never_reappends_after_reply_failure() {
    use axum::{
        Json, Router,
        extract::{Path, State},
        routing::post,
    };
    use std::sync::Mutex;
    let (_dir, store, user, service, list) = setup().await;
    link(&service, &user, &list, 99, 1).await;
    #[derive(Default)]
    struct Mock {
        polls: usize,
        sends: usize,
    }
    let state = Arc::new(Mutex::new(Mock::default()));
    async fn api(
        State(state): State<Arc<Mutex<Mock>>>,
        Path(method): Path<String>,
        Json(body): Json<serde_json::Value>,
    ) -> Json<serde_json::Value> {
        let mut mock = state.lock().unwrap();
        if method == "getUpdates" {
            mock.polls += 1;
            assert_eq!(body["allowed_updates"], serde_json::json!(["message"]));
            let updates = if mock.polls == 1 {
                serde_json::json!([{"update_id":2,"message":{"chat":{"id":99,"type":"private"},"from":{"id":99,"is_bot":false},"text":"captured through worker"}}])
            } else {
                serde_json::json!([])
            };
            Json(serde_json::json!({"ok":true,"result":updates}))
        } else {
            assert_eq!(method, "sendMessage");
            mock.sends += 1;
            Json(
                serde_json::json!({"ok":mock.sends>1,"result":{},"parameters":{"retry_after":123}}),
            )
        }
    }
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let app = Router::new()
        .route("/{method}", post(api))
        .with_state(state.clone());
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let mut worker = service.as_ref().clone();
    worker.client = client::Client::at(format!("http://{address}/")).unwrap();
    worker.cycle().await.unwrap();
    assert_eq!(store.get(&list).await.unwrap().nodes.len(), 1);
    let retry: i64 = sqlx::query_scalar("SELECT retry_at FROM telegram_receipts WHERE attempts=1")
        .fetch_one(&store.pool)
        .await
        .unwrap();
    assert!(
        retry >= now() + 120,
        "Telegram retry_after must be respected"
    );
    sqlx::query("UPDATE telegram_receipts SET retry_at=0")
        .execute(&store.pool)
        .await
        .unwrap();
    worker.cycle().await.unwrap();
    assert_eq!(store.get(&list).await.unwrap().nodes.len(), 1);
    assert_eq!(state.lock().unwrap().sends, 3);
    server.abort();
    let _ = server.await;
    store.pool.close().await;
}

#[tokio::test]
async fn labelled_link_destinations_are_preserved_as_literal_text() {
    let (_dir, store, user, service, list) = setup().await;
    link(&service, &user, &list, 99, 1).await;
    let mut incoming = update(2, 99, Some("A labelled link"));
    incoming.message.as_mut().unwrap().entities.push(Entity {
        kind: "text_link".into(),
        url: Some("https://example.org/full?x=1".into()),
    });
    service.process(incoming).await.unwrap();
    assert_eq!(
        store.get(&list).await.unwrap().nodes[0].text,
        "A labelled link\nhttps://example.org/full?x=1"
    );
    store.pool.close().await;
}

#[tokio::test]
async fn archived_inbox_rejects_capture_and_new_links_until_restored() {
    let (_dir, store, user, service, list) = setup().await;
    link(&service, &user, &list, 99, 1).await;
    store.set_archived(&list, 0, true).await.unwrap();
    assert!(service.issue_link(&user, &list).await.is_err());
    assert!(service.set_inbox(&user, &list).await.is_err());
    service
        .process(update(2, 99, Some("Must not be captured")))
        .await
        .unwrap();
    let current = store.get(&list).await.unwrap();
    assert!(current.nodes.is_empty());
    assert_eq!(current.revision, 1);
    store.set_archived(&list, 1, false).await.unwrap();
    service
        .process(update(3, 99, Some("Captured after restore")))
        .await
        .unwrap();
    let current = store.get(&list).await.unwrap();
    assert_eq!(current.revision, 3);
    assert_eq!(current.nodes[0].text, "Captured after restore");
}
