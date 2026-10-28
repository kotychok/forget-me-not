use axum::{
    body::Body,
    http::{Request, StatusCode},
    response::IntoResponse,
};
use forget_me_not::{Document, Item, MIGRATOR, SaveList, Store, app};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::Row;
use tower::ServiceExt;
use uuid::Uuid;

fn item(text: &str) -> Item {
    Item {
        id: Uuid::new_v4().to_string(),
        note: String::new(),
        tags: vec![],
        kind: "item".into(),
        text: text.into(),
        completed: false,
        children: vec![],
    }
}
async fn setup() -> (tempfile::TempDir, Store) {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(&dir.path().join("test.sqlite")).await.unwrap();
    (dir, store)
}
fn save(id: &str, revision: i64, title: &str, nodes: Vec<Item>) -> SaveList {
    SaveList {
        base_revision: revision,
        document: Document {
            id: id.into(),
            title: title.into(),
            nodes,
        },
    }
}
async fn call(
    store: &Store,
    method: &str,
    uri: &str,
    body: Value,
    origin: Option<&str>,
) -> (StatusCode, Value) {
    let mut builder = Request::builder()
        .method(method)
        .uri(uri)
        .header("host", "127.0.0.1:3001")
        .header("content-type", "application/json");
    if let Some(origin) = origin {
        builder = builder.header("origin", origin);
    }
    let response = app(
        store.clone(),
        3001,
        5173,
        std::path::Path::new("missing-assets"),
    )
    .oneshot(builder.body(Body::from(body.to_string())).unwrap())
    .await
    .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[tokio::test]
async fn migrations_and_identity_are_repeatable_and_data_survives_reopening() {
    let (dir, store) = setup().await;
    let owner = store.owner_id.clone();
    let list = store.create("Persistent".into()).await.unwrap();
    store
        .save(
            &list.id,
            save(&list.id, 0, "Renamed", vec![item("Remember")]),
        )
        .await
        .unwrap();
    MIGRATOR.run(&store.pool).await.unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM _sqlx_migrations WHERE success=1")
            .fetch_one(&store.pool)
            .await
            .unwrap(),
        MIGRATOR.iter().count() as i64
    );
    store.pool.close().await;
    let reopened = Store::open(&dir.path().join("test.sqlite")).await.unwrap();
    assert_eq!(owner, reopened.owner_id);
    let doc = reopened.get(&list.id).await.unwrap();
    assert_eq!(doc.title, "Renamed");
    assert_eq!(doc.revision, 1);
    assert_eq!(doc.nodes[0].text, "Remember");
    assert!(
        sqlx::query("PRAGMA foreign_key_check")
            .fetch_all(&reopened.pool)
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        sqlx::query_scalar::<_, String>("PRAGMA integrity_check")
            .fetch_one(&reopened.pool)
            .await
            .unwrap(),
        "ok"
    );
}

#[tokio::test]
async fn moves_use_row_diffs_preserving_descendant_ids_and_timestamps() {
    let (_dir, store) = setup().await;
    let list = store.create("Tree".into()).await.unwrap();
    let mut a = item("A");
    let mut b = item("B");
    let d = item("D");
    b.children.push(d.clone());
    let c = item("C");
    store
        .save(
            &list.id,
            save(&list.id, 0, "Tree", vec![a.clone(), b.clone(), c.clone()]),
        )
        .await
        .unwrap();
    let before = sqlx::query("SELECT created_at,updated_at FROM items WHERE id=?")
        .bind(&d.id)
        .fetch_one(&store.pool)
        .await
        .unwrap();
    a.children.push(b.clone());
    store
        .save(
            &list.id,
            save(&list.id, 1, "Tree", vec![a.clone(), c.clone()]),
        )
        .await
        .unwrap();
    let doc = store.get(&list.id).await.unwrap();
    assert_eq!(doc.nodes, vec![a, c]);
    assert_eq!(doc.revision, 2);
    let after = sqlx::query("SELECT parent_id,created_at,updated_at FROM items WHERE id=?")
        .bind(&d.id)
        .fetch_one(&store.pool)
        .await
        .unwrap();
    assert_eq!(after.get::<String, _>("parent_id"), b.id);
    assert_eq!(
        before.get::<i64, _>("created_at"),
        after.get::<i64, _>("created_at")
    );
    assert_eq!(
        before.get::<i64, _>("updated_at"),
        after.get::<i64, _>("updated_at")
    );
    store
        .save(&list.id, save(&list.id, 2, "Tree", vec![]))
        .await
        .unwrap();
    assert!(store.get(&list.id).await.unwrap().nodes.is_empty());
}

#[tokio::test]
async fn concurrent_stale_snapshots_cannot_overwrite_each_other() {
    let (_dir, store) = setup().await;
    let list = store.create("Initial".into()).await.unwrap();
    let (a, b) = tokio::join!(
        store.save(&list.id, save(&list.id, 0, "A", vec![])),
        store.save(&list.id, save(&list.id, 0, "B", vec![]))
    );
    assert_eq!(usize::from(a.is_ok()) + usize::from(b.is_ok()), 1);
    assert_eq!(
        a.err()
            .or_else(|| b.err())
            .unwrap()
            .into_response()
            .status(),
        StatusCode::CONFLICT
    );
    assert_eq!(store.get(&list.id).await.unwrap().revision, 1);
}

#[tokio::test]
async fn foreign_item_collision_rolls_back_title_revision_and_all_item_writes() {
    let (_dir, store) = setup().await;
    let first = store.create("First".into()).await.unwrap();
    let second = store.create("Second".into()).await.unwrap();
    let foreign = item("Foreign");
    store
        .save(
            &first.id,
            save(&first.id, 0, "First", vec![foreign.clone()]),
        )
        .await
        .unwrap();
    assert_eq!(
        store
            .save(
                &second.id,
                save(
                    &second.id,
                    0,
                    "Should roll back",
                    vec![foreign, item("New")]
                )
            )
            .await
            .unwrap_err()
            .into_response()
            .status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let doc = store.get(&second.id).await.unwrap();
    assert_eq!(doc.title, "Second");
    assert_eq!(doc.revision, 0);
    assert!(doc.nodes.is_empty());
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM items")
            .fetch_one(&store.pool)
            .await
            .unwrap(),
        1
    );
}

#[tokio::test]
async fn owner_scoping_covers_reads_writes_deletes_and_list_metadata() {
    let (_dir, store) = setup().await;
    let other_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO users VALUES (?,'Other',0)")
        .bind(&other_id)
        .execute(&store.pool)
        .await
        .unwrap();
    let other = Store {
        pool: store.pool.clone(),
        owner_id: other_id,
    };
    let list = other.create("Private".into()).await.unwrap();
    assert!(store.lists().await.unwrap().is_empty());
    assert_eq!(
        store
            .get(&list.id)
            .await
            .unwrap_err()
            .into_response()
            .status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        store
            .save(&list.id, save(&list.id, 0, "Leak", vec![]))
            .await
            .unwrap_err()
            .into_response()
            .status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        store
            .delete(&list.id, 0)
            .await
            .unwrap_err()
            .into_response()
            .status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(other.get(&list.id).await.unwrap().title, "Private");
}

#[tokio::test]
async fn validation_rejects_duplicate_ids_bad_completion_and_excess_depth() {
    let (_dir, store) = setup().await;
    let list = store.create("Valid".into()).await.unwrap();
    let node = item("Duplicate");
    assert_eq!(
        store
            .save(
                &list.id,
                save(&list.id, 0, "Valid", vec![node.clone(), node])
            )
            .await
            .unwrap_err()
            .into_response()
            .status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let mut invalid = item("Invalid");
    invalid.completed = true;
    assert!(
        store
            .save(&list.id, save(&list.id, 0, "Valid", vec![invalid]))
            .await
            .is_err()
    );
    let mut root = item("Deep");
    for _ in 0..32 {
        let mut parent = item("Parent");
        parent.children.push(root);
        root = parent;
    }
    assert!(
        store
            .save(&list.id, save(&list.id, 0, "Valid", vec![root]))
            .await
            .is_err()
    );
    assert_eq!(store.get(&list.id).await.unwrap().revision, 0);
}

#[tokio::test]
async fn deleting_a_list_cascades_items_but_checks_revision() {
    let (_dir, store) = setup().await;
    let list = store.create("Delete".into()).await.unwrap();
    let mut root = item("Root");
    root.children.push(item("Child"));
    store
        .save(&list.id, save(&list.id, 0, "Delete", vec![root]))
        .await
        .unwrap();
    assert_eq!(
        store
            .delete(&list.id, 0)
            .await
            .unwrap_err()
            .into_response()
            .status(),
        StatusCode::CONFLICT
    );
    store.delete(&list.id, 1).await.unwrap();
    assert!(store.lists().await.unwrap().is_empty());
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM items")
            .fetch_one(&store.pool)
            .await
            .unwrap(),
        0
    );
}

#[tokio::test]
async fn api_rejects_cross_origin_and_client_supplied_owner_and_handles_revision_contract() {
    let (_dir, store) = setup().await;
    assert_eq!(
        call(
            &store,
            "POST",
            "/api/lists",
            json!({"title":"Bad"}),
            Some("https://untrusted.example")
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            &store,
            "POST",
            "/api/lists",
            json!({"title":"Bad","ownerId":Uuid::new_v4().to_string()}),
            None
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let (status, doc) = call(
        &store,
        "POST",
        "/api/lists",
        json!({"title":"API"}),
        Some("http://127.0.0.1:5173"),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let id = doc["id"].as_str().unwrap();
    let body = json!({"baseRevision":0,"document":{"id":id,"title":"Updated","nodes":[]}});
    assert_eq!(
        call(
            &store,
            "PUT",
            &format!("/api/lists/{id}"),
            body.clone(),
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        call(&store, "PUT", &format!("/api/lists/{id}"), body, None)
            .await
            .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        call(&store, "GET", "/api/missing", Value::Null, None)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn deferred_constraint_commit_failure_is_rolled_back() {
    let (_dir, store) = setup().await;
    let list = store.create("Commit".into()).await.unwrap();
    let mut tx = store.pool.begin().await.unwrap();
    sqlx::query("UPDATE lists SET revision=1 WHERE id=?")
        .bind(&list.id)
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::query("INSERT INTO items(id,list_id,parent_id,position,kind,text,completed,created_at,updated_at) VALUES (?,?,?,0,'item','Bad',0,0,0)")
        .bind(Uuid::new_v4().to_string())
        .bind(&list.id)
        .bind(Uuid::new_v4().to_string())
        .execute(&mut *tx)
        .await
        .unwrap();
    assert!(tx.commit().await.is_err());
    let doc = store.get(&list.id).await.unwrap();
    assert_eq!(doc.revision, 0);
    assert!(doc.nodes.is_empty());
}

#[tokio::test]
async fn failed_sql_migration_is_atomic_and_unknown_versions_are_rejected() {
    let (_dir, store) = setup().await;
    let migrations = tempfile::tempdir().unwrap();
    for entry in std::fs::read_dir(concat!(env!("CARGO_MANIFEST_DIR"), "/migrations")).unwrap() {
        let entry = entry.unwrap();
        std::fs::copy(entry.path(), migrations.path().join(entry.file_name())).unwrap();
    }
    std::fs::write(
        migrations.path().join("20261026000300_broken.sql"),
        "CREATE TABLE partial_upgrade(id INTEGER); INSERT INTO missing_table VALUES(1);",
    )
    .unwrap();
    let runner = sqlx::migrate::Migrator::new(migrations.path())
        .await
        .unwrap();
    assert!(runner.run(&store.pool).await.is_err());
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM sqlite_master WHERE name='partial_upgrade'")
            .fetch_one(&store.pool)
            .await
            .unwrap();
    assert_eq!(count, 0);
    std::fs::write(
        migrations.path().join("20261026000300_broken.sql"),
        "CREATE TABLE future_schema(id INTEGER);",
    )
    .unwrap();
    let newer = sqlx::migrate::Migrator::new(migrations.path())
        .await
        .unwrap();
    newer.run(&store.pool).await.unwrap();
    assert!(MIGRATOR.run(&store.pool).await.is_err());
}

#[tokio::test]
async fn body_limit_and_invalid_host_reject_requests_before_mutation() {
    let (_dir, store) = setup().await;
    let response = app(
        store.clone(),
        3001,
        5173,
        std::path::Path::new("missing-assets"),
    )
    .oneshot(
        Request::builder()
            .method("POST")
            .uri("/api/lists")
            .header("host", "127.0.0.1:3001")
            .header("content-type", "application/json")
            .body(Body::from(
                json!({"title":"x".repeat(1024*1024)}).to_string(),
            ))
            .unwrap(),
    )
    .await
    .unwrap();
    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    let response = app(
        store.clone(),
        3001,
        5173,
        std::path::Path::new("missing-assets"),
    )
    .oneshot(
        Request::builder()
            .method("GET")
            .uri("/api/lists")
            .header("host", "untrusted.example:3001")
            .body(Body::empty())
            .unwrap(),
    )
    .await
    .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert!(store.lists().await.unwrap().is_empty());
}

#[tokio::test]
async fn installation_identity_is_stable_and_separate_from_the_owner() {
    let (dir, store) = setup().await;
    let identity = store.identity().await.unwrap();
    assert_eq!(
        Uuid::parse_str(&identity.server_id)
            .unwrap()
            .get_version_num(),
        4
    );
    assert_eq!(identity.owner_id, store.owner_id);
    let reopened = Store::open(&dir.path().join("test.sqlite")).await.unwrap();
    assert_eq!(identity, reopened.identity().await.unwrap());
    let other_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO users VALUES (?,'Other',0)")
        .bind(&other_id)
        .execute(&store.pool)
        .await
        .unwrap();
    let other = Store {
        pool: store.pool.clone(),
        owner_id: other_id.clone(),
    };
    assert_eq!(
        identity.server_id,
        other.identity().await.unwrap().server_id
    );
    assert_eq!(other_id, other.identity().await.unwrap().owner_id);
    let (status, body) = call(&store, "GET", "/api/session", Value::Null, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ownerId"], identity.owner_id);
    assert_eq!(body["serverId"], identity.server_id);
}

#[tokio::test]
async fn upgrade_from_m3_preserves_user_lists_items_and_revisions() {
    let dir = tempfile::tempdir().unwrap();
    let schema = tempfile::tempdir().unwrap();
    std::fs::write(
        schema.path().join("20261026000100_initial_schema.sql"),
        include_str!("../migrations/20261026000100_initial_schema.sql"),
    )
    .unwrap();
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            sqlx::sqlite::SqliteConnectOptions::new()
                .filename(dir.path().join("old.sqlite"))
                .create_if_missing(true)
                .foreign_keys(true),
        )
        .await
        .unwrap();
    sqlx::migrate::Migrator::new(schema.path())
        .await
        .unwrap()
        .run(&pool)
        .await
        .unwrap();
    let owner = Uuid::new_v4().to_string();
    let list = Uuid::new_v4().to_string();
    let node = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO users VALUES (?,'Existing owner',1)")
        .bind(&owner)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO local_identity VALUES (1,?)")
        .bind(&owner)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO lists VALUES (?,?,'Existing list',0,7,1,2)")
        .bind(&list)
        .bind(&owner)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO items(id,list_id,parent_id,position,kind,text,completed,created_at,updated_at) VALUES (?,?,NULL,0,'task','Existing content',1,1,2)")
        .bind(&node)
        .bind(&list)
        .execute(&pool)
        .await
        .unwrap();
    pool.close().await;
    let store = Store::open(&dir.path().join("old.sqlite")).await.unwrap();
    assert_eq!(store.owner_id, owner);
    let document = store.get(&list).await.unwrap();
    assert_eq!(document.revision, 7);
    assert_eq!(document.nodes[0].id, node);
    assert_eq!(document.nodes[0].text, "Existing content");
    assert!(document.nodes[0].completed);
    assert_eq!(store.identity().await.unwrap().owner_id, owner);
}
