use forget_me_not::{
    Document, SaveList, Store,
    error::AppError,
    incremental::Batch,
    portable::Portable,
    transfer::{self, Format},
};
use serde_json::json;
use uuid::Uuid;

#[tokio::test]
async fn archive_is_revision_checked_owned_read_only_and_round_trips_as_new_copies() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(&dir.path().join("archive.sqlite"))
        .await
        .unwrap();
    let list = store.create("Archived reference".into()).await.unwrap();
    let item_id = Uuid::new_v4().to_string();
    let document: Document = serde_json::from_value(json!({"id":list.id,"title":list.title,"nodes":[{"id":item_id,"kind":"task","text":"Keep literal source","note":"Note","tags":["Tag"],"dueDate":"2026-11-03","completed":false,"children":[]}]})).unwrap();
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
    assert!(matches!(
        store.set_archived(&list.id, 0, true).await,
        Err(AppError::Conflict)
    ));
    let archived = store.set_archived(&list.id, 1, true).await.unwrap();
    assert!(archived.archived);
    assert_eq!(archived.revision, 2);
    assert!(store.lists().await.unwrap()[0].archived);
    assert!(matches!(
        store
            .save(
                &list.id,
                SaveList {
                    base_revision: 2,
                    document: document.clone()
                }
            )
            .await,
        Err(AppError::Conflict)
    ));
    let batch=Batch::decode(&serde_json::to_vec(&json!({"protocolVersion":1,"operationId":Uuid::new_v4(),"baseRevision":2,"title":"Forbidden","ops":[]})).unwrap()).unwrap();
    assert!(matches!(
        store.save_incremental(&list.id, &batch).await,
        Err(AppError::Protocol("revision_conflict", _))
    ));
    let source = store.export_json(None).await.unwrap();
    assert_eq!(source.schema_version, 5);
    assert!(source.lists[0].archived);
    assert!(transfer::encode(Format::Markdown, &source).is_err());
    let encoded = transfer::encode(Format::Json, &source).unwrap();
    let decoded = transfer::decode(Format::Json, &encoded.text)
        .unwrap()
        .document;
    let copies = store.import_json(decoded).await.unwrap();
    assert!(copies[0].archived);
    assert_ne!(copies[0].id, list.id);
    let copy = store.get(&copies[0].id).await.unwrap();
    assert!(copy.archived);
    assert_ne!(copy.nodes[0].id, item_id);
    assert_eq!(copy.nodes[0].note, "Note");
    let backup = dir.path().join("backup.sqlite");
    let restored = dir.path().join("restored.sqlite");
    forget_me_not::maintenance::backup(&dir.path().join("archive.sqlite"), &backup)
        .await
        .unwrap();
    forget_me_not::maintenance::restore(&backup, &restored)
        .await
        .unwrap();
    let restored_store = Store::open(&restored).await.unwrap();
    assert!(restored_store.get(&list.id).await.unwrap().archived);
    assert_eq!(
        restored_store.get(&list.id).await.unwrap().nodes[0].id,
        item_id
    );
    let mut other = store.clone();
    other.owner_id = Uuid::new_v4().to_string();
    assert!(matches!(
        other.set_archived(&list.id, 2, false).await,
        Err(AppError::NotFound)
    ));
    assert!(matches!(
        store.set_archived(&list.id, 1, false).await,
        Err(AppError::Conflict)
    ));
    assert!(
        !store
            .set_archived(&list.id, 2, false)
            .await
            .unwrap()
            .archived
    );
    assert_eq!(
        store
            .save(
                &list.id,
                SaveList {
                    base_revision: 3,
                    document
                }
            )
            .await
            .unwrap(),
        4
    );
    store.delete(&copies[0].id, 0).await.unwrap();
    assert!(matches!(
        store.get(&copies[0].id).await,
        Err(AppError::NotFound)
    ));
}

#[test]
fn archive_state_is_strictly_versioned() {
    let list = json!({"id":Uuid::new_v4(),"title":"Archive","nodes":[],"archived":true});
    for version in 1..5 {
        assert!(
            Portable::from_value(json!({"schemaVersion":version,"lists":[list.clone()]})).is_err()
        );
    }
    let current = Portable::from_value(json!({"schemaVersion":5,"lists":[list.clone()]})).unwrap();
    assert!(current.lists[0].archived);
    let mut wrong = list;
    wrong["archived"] = json!("true");
    assert!(Portable::from_value(json!({"schemaVersion":5,"lists":[wrong]})).is_err());
}

#[tokio::test]
async fn concurrent_archive_transitions_and_old_save_receipts_do_not_reapply_content() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(&dir.path().join("race.sqlite")).await.unwrap();
    let list = store.create("Receipt".into()).await.unwrap();
    let batch = Batch::decode(&serde_json::to_vec(&json!({"protocolVersion":1,"operationId":Uuid::new_v4(),"baseRevision":0,"title":"Saved","ops":[]})).unwrap()).unwrap();
    let first = store.save_incremental(&list.id, &batch).await.unwrap();
    let (a, b) = tokio::join!(
        store.set_archived(&list.id, 1, true),
        store.set_archived(&list.id, 1, true)
    );
    assert_ne!(a.is_ok(), b.is_ok());
    assert_eq!(
        store.save_incremental(&list.id, &batch).await.unwrap(),
        first
    );
    let current = store.get(&list.id).await.unwrap();
    assert!(current.archived);
    assert_eq!(current.revision, 2);
    assert_eq!(current.title, "Saved");
}

#[tokio::test]
async fn archive_route_uses_existing_origin_guard_and_strict_json() {
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use tower::ServiceExt;
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(&dir.path().join("route.sqlite")).await.unwrap();
    let list = store.create("Route".into()).await.unwrap();
    let router = forget_me_not::app(
        store.clone(),
        3001,
        5173,
        std::path::Path::new("missing-assets"),
    );
    for (body, origin, expected) in [
        (
            json!({"baseRevision":0,"archived":true}),
            "https://foreign.test",
            StatusCode::FORBIDDEN,
        ),
        (
            json!({"baseRevision":0,"archived":true,"extra":1}),
            "http://127.0.0.1:5173",
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            json!({"baseRevision":0,"archived":true}),
            "http://127.0.0.1:5173",
            StatusCode::OK,
        ),
    ] {
        let req = Request::builder()
            .method("PATCH")
            .uri(format!("/api/lists/{}/archive", list.id))
            .header("host", "127.0.0.1:3001")
            .header("origin", origin)
            .header("content-type", "application/json");
        let response = router
            .clone()
            .oneshot(req.body(Body::from(body.to_string())).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), expected);
    }
    assert!(store.get(&list.id).await.unwrap().archived);
}
