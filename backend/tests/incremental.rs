use forget_me_not::{
    Document, SaveList, Store,
    error::AppError,
    incremental::{Acknowledgement, Batch},
    model::Item,
};
use serde_json::{Value, json};
use uuid::Uuid;
fn item(text: &str) -> Item {
    Item {
        id: Uuid::new_v4().to_string(),
        kind: "item".into(),
        text: text.into(),
        note: String::new(),
        tags: vec![],
        due_date: None,
        completed: false,
        children: vec![],
    }
}
async fn setup() -> (tempfile::TempDir, Store, String, Item, Item, Item) {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(&dir.path().join("delta.sqlite")).await.unwrap();
    let list = store.create("Original".into()).await.unwrap();
    let mut a = item("A");
    let mut b = item("B");
    let c = item("C");
    b.note = "Old note".into();
    b.tags = vec!["Tag".into()];
    b.due_date = Some("2026-11-02".into());
    a.children = vec![b.clone()];
    store
        .save(
            &list.id,
            SaveList {
                base_revision: 0,
                document: Document {
                    archived: false,
                    id: list.id.clone(),
                    title: list.title,
                    nodes: vec![a.clone(), c.clone()],
                },
            },
        )
        .await
        .unwrap();
    (dir, store, list.id, a, b, c)
}
fn packet(revision: i64, ops: Value) -> Batch {
    Batch::decode(&serde_json::to_vec(&json!({"protocolVersion":1,"operationId":Uuid::new_v4().to_string(),"baseRevision":revision,"ops":ops})).unwrap()).unwrap()
}
fn code<T: std::fmt::Debug>(result: Result<T, AppError>, expected: &str) {
    assert!(
        matches!(result,Err(AppError::Protocol(actual,_)) if actual==expected),
        "expected {expected}"
    );
}
#[tokio::test]
async fn branch_rescue_creation_clears_and_replay_after_another_writer_are_atomic() {
    let (_dir, store, id, a, b, c) = setup().await;
    let parent = Uuid::new_v4().to_string();
    let child = Uuid::new_v4().to_string();
    let before: (i64, i64) = sqlx::query_as("SELECT created_at,updated_at FROM items WHERE id=?")
        .bind(&b.id)
        .fetch_one(&store.pool)
        .await
        .unwrap();
    let mut batch = packet(
        1,
        json!([
            {"type":"move","itemId":b.id,"parentId":null,"afterId":a.id},
            {"type":"remove","itemId":a.id},
            {"type":"create","item":{"id":parent,"kind":"item","text":"Parent","completed":false},"parentId":null,"afterId":null},
            {"type":"move","itemId":b.id,"parentId":parent,"afterId":null},
            {"type":"update","itemId":b.id,"changes":{"note":"","tags":[],"dueDate":null,"text":"Changed 🌿"}},
            {"type":"create","item":{"id":child,"kind":"task","text":"Child","completed":false},"parentId":b.id,"afterId":null}
        ]),
    );
    batch.title = Some("Renamed".into());
    let ack = store.save_incremental(&id, &batch).await.unwrap();
    assert_eq!(ack.revision, 2);
    let doc = store.get(&id).await.unwrap();
    assert_eq!(doc.nodes.len(), 2);
    assert_eq!(doc.nodes[1].id, c.id);
    let changed = &doc.nodes[0].children[0];
    assert_eq!(changed.id, b.id);
    assert_eq!(changed.note, "");
    assert_eq!(changed.tags.len(), 0);
    assert_eq!(changed.due_date, None);
    assert_eq!(changed.children[0].id, child);
    let created: i64 = sqlx::query_scalar("SELECT created_at FROM items WHERE id=?")
        .bind(&b.id)
        .fetch_one(&store.pool)
        .await
        .unwrap();
    assert_eq!(created, before.0);
    store
        .save(
            &id,
            SaveList {
                base_revision: 2,
                document: Document {
                    archived: false,
                    id: id.clone(),
                    title: "Another device".into(),
                    nodes: doc.nodes,
                },
            },
        )
        .await
        .unwrap();
    assert_eq!(store.save_incremental(&id, &batch).await.unwrap(), ack);
    assert_eq!(store.get(&id).await.unwrap().revision, 3);
    batch.title = Some("Different payload".into());
    code(
        store.save_incremental(&id, &batch).await,
        "operation_id_reused",
    );
    store.pool.close().await;
}
#[test]
fn strict_packet_decoding_and_canonical_hash_vectors() {
    let op = "90de58d3-9654-4c25-a34f-10fbaf3d872f";
    let raw = format!(
        r#"{{"protocolVersion":1,"operationId":"{op}","baseRevision":0,"title":"Нотатка","ops":[]}}"#
    );
    let batch = Batch::decode(raw.as_bytes()).unwrap();
    let reordered = format!(
        r#"{{"ops":[],"title":"\u041dотатка","baseRevision":0,"operationId":"{op}","protocolVersion":1}}"#
    );
    let other = Batch::decode(reordered.as_bytes()).unwrap();
    assert_eq!(batch.hash(op).unwrap(), other.hash(op).unwrap());
    let expected = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../fixtures/incremental-hash.txt"
    ))
    .unwrap();
    let hex: String = batch
        .hash(op)
        .unwrap()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    assert_eq!(hex, expected.trim());
    for invalid in [
        format!(
            r#"{{"protocolVersion":1,"operationId":"{op}","baseRevision":0,"title":null,"ops":[]}}"#
        ),
        format!(
            r#"{{"protocolVersion":1,"operationId":"{op}","baseRevision":0,"title":"x","title":"y","ops":[]}}"#
        ),
        format!(
            r#"{{"protocolVersion":1,"operationId":"{op}","baseRevision":0,"ops":[{{"type":"move","itemId":"{op}"}}]}}"#
        ),
        format!(
            r#"{{"protocolVersion":1.0,"operationId":"{op}","baseRevision":0,"title":"x","ops":[]}}"#
        ),
    ] {
        code(Batch::decode(invalid.as_bytes()), "invalid_batch");
    }
    code(Batch::decode(br#"{"protocolVersion":2,"operationId":"90de58d3-9654-4c25-a34f-10fbaf3d872f","baseRevision":0,"title":"x","ops":[]}"#),"unsupported_save_version");
    let id = Uuid::new_v4().to_string();
    let one = packet(
        0,
        json!([{"type":"create","item":{"id":id,"kind":"item","text":"","completed":false},"parentId":null,"afterId":null}]),
    );
    let two=Batch::decode(&serde_json::to_vec(&json!({"protocolVersion":1,"operationId":one.operation_id,"baseRevision":0,"ops":[{"type":"create","item":{"id":id,"kind":"item","text":"","completed":false,"note":"","tags":[],"dueDate":null},"parentId":null,"afterId":null}]})).unwrap()).unwrap();
    assert_eq!(one.hash(op).unwrap(), two.hash(op).unwrap());
}
#[tokio::test]
async fn invalid_references_cycles_and_id_collisions_roll_back_the_whole_batch() {
    let (_dir, store, id, a, b, _c) = setup().await;
    let other = store.create("Other".into()).await.unwrap();
    let foreign = item("Foreign");
    store
        .save(
            &other.id,
            SaveList {
                base_revision: 0,
                document: Document {
                    archived: false,
                    id: other.id.clone(),
                    title: other.title,
                    nodes: vec![foreign.clone()],
                },
            },
        )
        .await
        .unwrap();
    for (op, expected) in [
        (
            json!({"type":"move","itemId":a.id,"parentId":b.id,"afterId":null}),
            "invalid_structure",
        ),
        (
            json!({"type":"move","itemId":b.id,"parentId":foreign.id,"afterId":null}),
            "invalid_reference",
        ),
        (
            json!({"type":"remove","itemId":foreign.id}),
            "invalid_reference",
        ),
        (
            json!({"type":"create","item":{"id":foreign.id,"kind":"item","text":"Steal","completed":false},"parentId":null,"afterId":null}),
            "invalid_batch",
        ),
    ] {
        let batch = packet(
            1,
            json!([{"type":"update","itemId":b.id,"changes":{"text":"must roll back"}},op]),
        );
        code(store.save_incremental(&id, &batch).await, expected);
        let doc = store.get(&id).await.unwrap();
        assert_eq!(doc.revision, 1);
        assert_eq!(doc.nodes[0].children[0].text, "B");
    }
    let receipts: i64 = sqlx::query_scalar("SELECT count(*) FROM incremental_save_receipts")
        .fetch_one(&store.pool)
        .await
        .unwrap();
    assert_eq!(receipts, 0);
    let batch = packet(
        1,
        json!([{"type":"remove","itemId":a.id},{"type":"update","itemId":b.id,"changes":{"text":"gone"}}]),
    );
    code(
        store.save_incremental(&id, &batch).await,
        "invalid_reference",
    );
    store.pool.close().await;
}
#[tokio::test]
async fn simultaneous_identical_packets_commit_once_and_different_packets_conflict() {
    let (_dir, store, id, _a, b, _c) = setup().await;
    let batch = packet(
        1,
        json!([{"type":"update","itemId":b.id,"changes":{"text":"Once"}}]),
    );
    let (first, second) = tokio::join!(
        store.save_incremental(&id, &batch),
        store.save_incremental(&id, &batch)
    );
    assert_eq!(first.unwrap(), second.unwrap());
    let next = packet(
        2,
        json!([{"type":"update","itemId":b.id,"changes":{"text":"One"}}]),
    );
    let other = packet(
        2,
        json!([{"type":"update","itemId":b.id,"changes":{"text":"Two"}}]),
    );
    let (one, two) = tokio::join!(
        store.save_incremental(&id, &next),
        store.save_incremental(&id, &other)
    );
    assert_ne!(one.is_ok(), two.is_ok());
    assert_eq!(store.get(&id).await.unwrap().revision, 3);
    store.pool.close().await;
}
#[tokio::test]
async fn expired_evicted_and_restored_receipts_do_not_reapply_a_committed_packet() {
    let (dir, store, id, _a, b, _c) = setup().await;
    let batch = packet(
        1,
        json!([{"type":"update","itemId":b.id,"changes":{"text":"Recorded"}}]),
    );
    store.save_incremental(&id, &batch).await.unwrap();
    sqlx::query("UPDATE incremental_save_receipts SET expires_at=0")
        .execute(&store.pool)
        .await
        .unwrap();
    code(
        store.save_incremental(&id, &batch).await,
        "revision_conflict",
    );
    store.expire_save_receipts().await.unwrap();
    let installation = store.identity().await.unwrap().server_id;
    sqlx::query("WITH RECURSIVE seq(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM seq WHERE x<10001) INSERT INTO incremental_save_receipts(installation_id,owner_id,list_id,operation_id,request_hash,applied_revision,created_at,expires_at) SELECT ?,?,?,printf('00000000-0000-4000-8000-%012d',x),zeroblob(32),2,?,? FROM seq")
        .bind(installation).bind(&store.owner_id).bind(&id).bind(forget_me_not::auth::now()).bind(forget_me_not::auth::now()+86400).execute(&store.pool).await.unwrap();
    let next = packet(
        2,
        json!([{"type":"update","itemId":b.id,"changes":{"text":"Newest"}}]),
    );
    store.save_incremental(&id, &next).await.unwrap();
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM incremental_save_receipts")
        .fetch_one(&store.pool)
        .await
        .unwrap();
    assert_eq!(count, 10000);
    let snapshot = dir.path().join("backup.sqlite");
    let restored = dir.path().join("restored.sqlite");
    forget_me_not::maintenance::backup(&dir.path().join("delta.sqlite"), &snapshot)
        .await
        .unwrap();
    forget_me_not::maintenance::restore(&snapshot, &restored)
        .await
        .unwrap();
    let copy = Store::open(&restored).await.unwrap();
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM incremental_save_receipts")
        .fetch_one(&copy.pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
    code(copy.save_incremental(&id, &next).await, "revision_conflict");
    copy.pool.close().await;
    store.pool.close().await;
}
#[tokio::test]
async fn http_patch_keeps_gzip_auth_owner_and_installation_guards() {
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use http_body_util::BodyExt;
    use std::io::Write;
    use tower::ServiceExt;
    let (_dir, store, id, _a, b, _c) = setup().await;
    forget_me_not::auth::bootstrap(
        &store,
        "owner",
        "Synthetic incremental test password!".into(),
        false,
    )
    .await
    .unwrap();
    let router = forget_me_not::authenticated_app(
        store.clone(),
        3001,
        5173,
        std::path::Path::new("missing"),
    )
    .await
    .unwrap();
    let login = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/login")
                .header("host", "127.0.0.1:3001")
                .header("x-fmn-request", "1")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"login":"owner","password":"Synthetic incremental test password!"}"#,
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
        .unwrap();
    let batch = packet(
        1,
        json!([{"type":"update","itemId":b.id,"changes":{"note":"Content ".repeat(5000)}}]),
    );
    let mut gzip = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    gzip.write_all(&serde_json::to_vec(&batch).unwrap())
        .unwrap();
    let body = gzip.finish().unwrap();
    for (authenticated, marker, owner, installation, expected) in [
        (
            false,
            true,
            store.owner_id.as_str(),
            "",
            StatusCode::UNAUTHORIZED,
        ),
        (
            true,
            false,
            store.owner_id.as_str(),
            "",
            StatusCode::FORBIDDEN,
        ),
        (true, true, "another-owner", "", StatusCode::UNAUTHORIZED),
        (
            true,
            true,
            store.owner_id.as_str(),
            "old-installation",
            StatusCode::UNAUTHORIZED,
        ),
        (true, true, store.owner_id.as_str(), "", StatusCode::OK),
    ] {
        let mut req = Request::builder()
            .method("PATCH")
            .uri(format!("/api/lists/{id}"))
            .header("host", "127.0.0.1:3001")
            .header("content-type", "application/json")
            .header("content-encoding", "gzip")
            .header("x-fmn-owner", owner);
        if authenticated {
            req = req.header("cookie", cookie);
        }
        if marker {
            req = req.header("x-fmn-request", "1");
        }
        if !installation.is_empty() {
            req = req.header("x-fmn-installation", installation);
        }
        let response = router
            .clone()
            .oneshot(req.body(Body::from(body.clone())).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), expected);
        if expected == StatusCode::OK {
            let ack: Acknowledgement =
                serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                    .unwrap();
            assert_eq!(ack.revision, 2);
        }
    }
    store.pool.close().await;
}

#[test]
fn work_and_result_limits_reject_batches_before_persistence() {
    let root = item("Root");
    let document = Document {
        archived: false,
        id: Uuid::new_v4().to_string(),
        title: "Limits".into(),
        nodes: (0..5000)
            .map(|i| {
                let mut node = root.clone();
                if i != 0 {
                    node.id = Uuid::new_v4().to_string();
                }
                node
            })
            .collect(),
    };
    let updates = vec![json!({"type":"update","itemId":root.id,"changes":{"text":"Changed"}}); 401];
    code(packet(0, json!(updates)).apply(document), "limit_exceeded");
    let mut root = root;
    root.note = "x".repeat(65536);
    let document = Document {
        archived: false,
        id: Uuid::new_v4().to_string(),
        title: "Limits".into(),
        nodes: (0..20)
            .map(|_| {
                let mut node = root.clone();
                node.id = Uuid::new_v4().to_string();
                node
            })
            .collect(),
    };
    let batch = packet(
        0,
        json!([{"type":"update","itemId":document.nodes[0].id,"changes":{"text":"Changed"}}]),
    );
    code(batch.apply(document), "limit_exceeded");
}
