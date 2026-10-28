use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use forget_me_not::{Store, app, portable::Portable};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
use uuid::Uuid;
fn fixture() -> Portable {
    serde_json::from_str(include_str!("../../fixtures/portable-v1.json")).unwrap()
}
async fn setup() -> (tempfile::TempDir, Store) {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(&dir.path().join("test.sqlite")).await.unwrap();
    (dir, store)
}
async fn request(store: &Store, method: &str, path: &str, value: Value) -> (StatusCode, Value) {
    let response = app(
        store.clone(),
        3001,
        5173,
        std::path::Path::new("missing-assets"),
    )
    .oneshot(
        Request::builder()
            .method(method)
            .uri(path)
            .header("host", "127.0.0.1:3001")
            .header("content-type", "application/json")
            .body(Body::from(value.to_string()))
            .unwrap(),
    )
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
async fn import_creates_new_ids_and_preserves_content_without_overwriting_existing_lists() {
    let (_dir, store) = setup().await;
    let existing = store.create("Existing".into()).await.unwrap();
    let original = fixture();
    let source_id = original.lists[0].id.clone();
    let source_node = original.lists[0].nodes[0].id.clone();
    let imported = store.import_json(original).await.unwrap();
    assert_eq!(imported.len(), 2);
    assert_ne!(imported[0].id, source_id);
    let copy = store.get(&imported[0].id).await.unwrap();
    assert_ne!(copy.nodes[0].id, source_node);
    assert_eq!(copy.nodes[0].text, "Planning ✈️\nA second line");
    assert!(copy.nodes[0].children[0].completed);
    assert_eq!(store.get(&existing.id).await.unwrap().title, "Existing");
    assert_eq!(store.lists().await.unwrap().len(), 3);
    let exported = store.export_json(Some(&copy.id)).await.unwrap();
    let again = serde_json::to_value(&exported).unwrap();
    assert_eq!(again["schemaVersion"], 3);
    assert!(again["lists"][0].get("revision").is_none());
    assert!(again["lists"][0].get("ownerId").is_none());
    assert_eq!(again["lists"][0]["nodes"][0]["id"], copy.nodes[0].id);
    let second = store.import_json(fixture()).await.unwrap();
    assert_ne!(second[0].id, copy.id);
    assert_eq!(store.lists().await.unwrap().len(), 5);
}
#[tokio::test]
async fn a_database_failure_in_the_second_list_rolls_back_the_whole_import() {
    let (_dir, store) = setup().await;
    let existing = store.create("Existing".into()).await.unwrap();
    sqlx::query("CREATE TRIGGER fail_second BEFORE INSERT ON lists WHEN NEW.title='An empty list' BEGIN SELECT RAISE(ABORT,'simulated failure'); END").execute(&store.pool).await.unwrap();
    assert!(store.import_json(fixture()).await.is_err());
    let lists = store.lists().await.unwrap();
    assert_eq!(lists.len(), 1);
    assert_eq!(lists[0].id, existing.id);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM items")
            .fetch_one(&store.pool)
            .await
            .unwrap(),
        0
    );
}
#[tokio::test]
async fn export_only_includes_owned_lists_and_preserves_creation_order() {
    let (_dir, store) = setup().await;
    let imported = store.import_json(fixture()).await.unwrap();
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
    let private = other.create("Private".into()).await.unwrap();
    assert!(store.export_json(Some(&private.id)).await.is_err());
    let all = store.export_json(None).await.unwrap();
    assert_eq!(
        all.lists.iter().map(|list| &list.id).collect::<Vec<_>>(),
        imported.iter().map(|list| &list.id).collect::<Vec<_>>()
    );
}
#[tokio::test]
async fn invalid_files_are_rejected_with_paths_before_writing() {
    let (_dir, store) = setup().await;
    let mut value = serde_json::to_value(fixture()).unwrap();
    value["lists"][1]["nodes"] = value["lists"][0]["nodes"].clone();
    let (status, error) = request(&store, "POST", "/api/import", value).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(error["error"].as_str().unwrap().contains("$.lists[1]"));
    assert!(store.lists().await.unwrap().is_empty());
    let mut value = serde_json::to_value(fixture()).unwrap();
    value["schemaVersion"] = json!(9);
    assert_eq!(
        request(&store, "POST", "/api/import", value).await.0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let mut value = serde_json::to_value(fixture()).unwrap();
    value["lists"][0]["ownerId"] = json!(Uuid::new_v4().to_string());
    let (_, error) = request(&store, "POST", "/api/import", value).await;
    assert!(error["error"].as_str().unwrap().contains("ownerId"));
}
#[tokio::test]
async fn import_route_accepts_a_valid_multi_list_file_larger_than_the_snapshot_body_limit() {
    let (_dir, store) = setup().await;
    let mut source = fixture();
    source.lists[1].nodes.clear();
    for list in &mut source.lists {
        list.nodes = (0..25)
            .map(|_| forget_me_not::Item {
                id: Uuid::new_v4().to_string(),
                note: String::new(),
                tags: vec![],
                kind: "item".into(),
                text: "x".repeat(24000),
                completed: false,
                children: vec![],
            })
            .collect();
    }
    let value = serde_json::to_value(source).unwrap();
    assert!(value.to_string().len() > 1024 * 1024);
    assert_eq!(
        request(&store, "POST", "/api/import", value).await.0,
        StatusCode::CREATED
    );
}
