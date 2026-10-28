use forget_me_not::{
    SaveList, Store,
    portable::Portable,
    transfer::{self, Format},
};
use serde_json::json;
fn fixture() -> serde_json::Value {
    let mut value: serde_json::Value =
        serde_json::from_str(include_str!("../../fixtures/portable-v4.json")).unwrap();
    value["schemaVersion"] = json!(4);
    value["lists"][0]["nodes"][0]["dueDate"] = json!("2028-02-29");
    value
}
#[test]
fn dates_are_real_gregorian_calendar_strings_in_v4_only() {
    let mut value = fixture();
    for date in ["0001-01-01", "9999-12-31", "2000-02-29", "2028-02-29"] {
        value["lists"][0]["nodes"][0]["dueDate"] = json!(date);
        assert!(Portable::from_value(value.clone()).is_ok(), "{date}");
    }
    for date in [
        json!(null),
        json!(""),
        json!("0000-01-01"),
        json!("1900-02-29"),
        json!("2100-02-29"),
        json!("2026-02-29"),
        json!("2026-04-31"),
        json!("2026-13-01"),
        json!("2026-01-00"),
        json!("2026-1-01"),
        json!("2026-10-28T00:00:00Z"),
        json!("２０２６-10-28"),
    ] {
        value["lists"][0]["nodes"][0]["dueDate"] = date.clone();
        assert!(Portable::from_value(value.clone()).is_err(), "{date}");
    }
    value = fixture();
    value["schemaVersion"] = json!(3);
    assert!(Portable::from_value(value).is_err());
}
#[tokio::test]
async fn dates_persist_copy_clear_and_enforce_revisions_without_lossy_markdown() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(&dir.path().join("dates.sqlite")).await.unwrap();
    let imported = store
        .import_json(Portable::from_value(fixture()).unwrap())
        .await
        .unwrap();
    let original = store.get(&imported[0].id).await.unwrap();
    assert_eq!(original.nodes[0].due_date.as_deref(), Some("2028-02-29"));
    let exported = store.export_json(Some(&original.id)).await.unwrap();
    assert_eq!(exported.schema_version, 4);
    // Isolate the date export guard from the pre-existing note/tag guards.
    let mut only_date = Portable::from_value(fixture()).unwrap();
    only_date.lists.truncate(1);
    only_date.lists[0].nodes[0].note.clear();
    only_date.lists[0].nodes[0].tags.clear();
    assert!(
        matches!(transfer::encode(Format::Markdown, &only_date), Err(forget_me_not::error::AppError::InvalidImport(message)) if message.contains("due dates"))
    );
    let encoded = transfer::encode(Format::Json, &exported).unwrap();
    let copies = store
        .import_json(
            transfer::decode(Format::Json, &encoded.text)
                .unwrap()
                .document,
        )
        .await
        .unwrap();
    let copy = store.get(&copies[0].id).await.unwrap();
    assert_eq!(copy.nodes[0].due_date, original.nodes[0].due_date);
    assert_ne!(copy.nodes[0].id, original.nodes[0].id);
    let mut changed = exported.lists.into_iter().next().unwrap();
    changed.nodes[0].due_date = Some("2026-02-30".into());
    assert!(
        store
            .save(
                &original.id,
                SaveList {
                    base_revision: original.revision,
                    document: changed.clone()
                }
            )
            .await
            .is_err()
    );
    assert_eq!(
        store.get(&original.id).await.unwrap().revision,
        original.revision
    );
    changed.nodes[0].due_date = Some("2029-03-01".into());
    store
        .save(
            &original.id,
            SaveList {
                base_revision: original.revision,
                document: changed.clone(),
            },
        )
        .await
        .unwrap();
    assert_eq!(
        store.get(&original.id).await.unwrap().nodes[0]
            .due_date
            .as_deref(),
        Some("2029-03-01")
    );
    changed.nodes[0].due_date = None;
    store
        .save(
            &original.id,
            SaveList {
                base_revision: original.revision + 1,
                document: changed.clone(),
            },
        )
        .await
        .unwrap();
    assert!(
        store
            .save(
                &original.id,
                SaveList {
                    base_revision: original.revision,
                    document: changed
                }
            )
            .await
            .is_err()
    );
    assert!(
        store.get(&original.id).await.unwrap().nodes[0]
            .due_date
            .is_none()
    );
    assert!(
        store.get(&copy.id).await.unwrap().nodes[0]
            .due_date
            .is_some()
    );
}

#[tokio::test]
async fn additive_upgrade_from_m9_preserves_content_and_view_preferences() {
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use uuid::Uuid;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("upgrade.sqlite");
    let migrations = dir.path().join("old");
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
        (
            "20261027000400_item_notes.sql",
            include_str!("../migrations/20261027000400_item_notes.sql"),
        ),
        (
            "20261028000500_item_tags.sql",
            include_str!("../migrations/20261028000500_item_tags.sql"),
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
    sqlx::query("INSERT INTO lists VALUES (?,?,'Existing',0,7,1,2)")
        .bind(&list)
        .bind(&owner)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO items(id,list_id,parent_id,position,kind,text,completed,created_at,updated_at,note) VALUES (?,?,NULL,0,'task','Parent',1,1,2,'Existing note')").bind(&root).bind(&list).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO items(id,list_id,parent_id,position,kind,text,completed,created_at,updated_at,note) VALUES (?,?,?,0,'item','Child',0,1,2,'')").bind(&child).bind(&list).bind(&root).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO list_view_states VALUES (?,?,?,3)")
        .bind(&owner)
        .bind(&list)
        .bind(json!([root]).to_string())
        .execute(&pool)
        .await
        .unwrap();
    pool.close().await;
    let store = Store::open(&path).await.unwrap();
    let document = store.get(&list).await.unwrap();
    assert_eq!(document.revision, 7);
    assert_eq!(document.nodes[0].note, "Existing note");
    assert!(document.nodes[0].tags.is_empty());
    assert!(document.nodes[0].due_date.is_none());
    assert_eq!(document.nodes[0].id, root);
    assert_eq!(document.nodes[0].children[0].id, child);
    assert!(document.nodes[0].completed);
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
