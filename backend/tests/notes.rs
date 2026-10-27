use forget_me_not::{
    SaveList, Store,
    portable::Portable,
    transfer::{self, Format},
};
use serde_json::json;
fn fixture() -> serde_json::Value {
    serde_json::from_str(include_str!("../../fixtures/portable-v1.json")).unwrap()
}
#[tokio::test]
async fn notes_persist_copy_and_export_in_v2_while_legacy_files_still_import() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(&dir.path().join("test.sqlite")).await.unwrap();
    let v2 = Portable::from_value(
        serde_json::from_str(include_str!("../../fixtures/portable-v2.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(
        v2.lists[0].nodes[0].note,
        "**Trip details**\nBring the itinerary. ✈️"
    );
    let mut legacy = fixture();
    let upgraded = Portable::from_value(legacy.clone()).unwrap();
    assert_eq!(upgraded.schema_version, 2);
    legacy["lists"][0]["nodes"][0]["note"] = json!("No v1 notes");
    assert!(Portable::from_value(legacy.clone()).is_err());
    legacy["schemaVersion"] = json!(2);
    legacy["lists"][0]["nodes"][0]["note"] = json!("**Literal**\n<html>note</html>");
    let source = Portable::from_value(legacy).unwrap();
    let copies = store.import_json(source).await.unwrap();
    let original = store.get(&copies[0].id).await.unwrap();
    assert_eq!(original.nodes[0].note, "**Literal**\n<html>note</html>");
    let exported = store.export_json(Some(&original.id)).await.unwrap();
    assert_eq!(exported.schema_version, 2);
    assert!(transfer::encode(Format::Markdown, &exported).is_err());
    let text = transfer::encode(Format::Json, &exported).unwrap().text;
    let copy = store
        .import_json(transfer::decode(Format::Json, &text).unwrap().document)
        .await
        .unwrap();
    assert_eq!(
        store.get(&copy[0].id).await.unwrap().nodes[0].note,
        original.nodes[0].note
    );
    let mut document = exported.lists.into_iter().next().unwrap();
    document.nodes[0].note = "Updated".into();
    store
        .save(
            &original.id,
            SaveList {
                base_revision: original.revision,
                document,
            },
        )
        .await
        .unwrap();
    assert_eq!(
        store.get(&original.id).await.unwrap().nodes[0].note,
        "Updated"
    );
}
#[test]
fn note_limits_and_future_versions_are_rejected_before_import() {
    let mut source = fixture();
    source["schemaVersion"] = json!(2);
    source["lists"][0]["nodes"][0]["note"] = json!("a".repeat(65537));
    assert!(Portable::from_value(source.clone()).is_err());
    source["lists"][0]["nodes"][0]["note"] = json!("a".repeat(65536));
    assert!(Portable::from_value(source.clone()).is_ok());
    source["schemaVersion"] = json!(3);
    assert!(Portable::from_value(source).is_err());
}

#[tokio::test]
async fn upgrade_from_m6b_preserves_content_and_saved_view_preferences() {
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use uuid::Uuid;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("upgrade.sqlite");
    let migrations = dir.path().join("migrations");
    std::fs::create_dir(&migrations).unwrap();
    for (name, sql) in [
        (
            "20261026000100_initial_schema.sql",
            include_str!("../migrations/20261026000100_initial_schema.sql"),
        ),
        (
            "20261026000200_installation_identity.sql",
            include_str!("../migrations/20261026000200_installation_identity.sql"),
        ),
        (
            "20261027000300_list_view_states.sql",
            include_str!("../migrations/20261027000300_list_view_states.sql"),
        ),
    ] {
        std::fs::write(migrations.join(name), sql).unwrap();
    }
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            SqliteConnectOptions::new()
                .filename(&path)
                .create_if_missing(true)
                .foreign_keys(true),
        )
        .await
        .unwrap();
    sqlx::migrate::Migrator::new(migrations.as_path())
        .await
        .unwrap()
        .run(&pool)
        .await
        .unwrap();
    let owner = Uuid::new_v4().to_string();
    let installation = Uuid::new_v4().to_string();
    let list = Uuid::new_v4().to_string();
    let root = Uuid::new_v4().to_string();
    let child = Uuid::new_v4().to_string();
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
    sqlx::query("INSERT INTO installation VALUES (1,?)")
        .bind(&installation)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO lists VALUES (?,?,'Original',0,7,1,2)")
        .bind(&list)
        .bind(&owner)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO items VALUES (?,?,NULL,0,'task','Parent',1,1,2)")
        .bind(&root)
        .bind(&list)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO items VALUES (?,?,?,0,'item','Child',0,1,2)")
        .bind(&child)
        .bind(&list)
        .bind(&root)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO list_view_states VALUES (?,?,?,3)")
        .bind(&owner)
        .bind(&list)
        .bind(json!([root]).to_string())
        .execute(&pool)
        .await
        .unwrap();
    pool.close().await;
    let store = Store::open(&path).await.unwrap();
    let content = store.get(&list).await.unwrap();
    assert_eq!(content.revision, 7);
    assert_eq!(content.nodes[0].id, root);
    assert_eq!(content.nodes[0].children[0].id, child);
    assert!(content.nodes[0].completed);
    assert_eq!(content.nodes[0].note, "");
    let view = store.outline_view(&list).await.unwrap();
    assert_eq!(view.revision, 3);
    assert_eq!(view.collapsed_item_ids, vec![root]);
    assert_eq!(store.identity().await.unwrap().server_id, installation);
    assert!(
        sqlx::query("PRAGMA foreign_key_check")
            .fetch_all(&store.pool)
            .await
            .unwrap()
            .is_empty()
    );
}
