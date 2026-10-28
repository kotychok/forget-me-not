use forget_me_not::{
    SaveList, Store,
    portable::Portable,
    transfer::{self, Format},
};
use serde_json::json;
fn fixture() -> serde_json::Value {
    serde_json::from_str(include_str!("../../fixtures/portable-v2.json")).unwrap()
}
#[test]
fn older_formats_upgrade_but_only_v3_accepts_valid_bounded_tags() {
    let shared = Portable::from_value(
        serde_json::from_str(include_str!("../../fixtures/portable-v3.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(shared.lists[0].nodes[0].tags, vec!["travel", "planning"]);
    let mut value = fixture();
    assert_eq!(
        Portable::from_value(value.clone()).unwrap().schema_version,
        3
    );
    value["lists"][0]["nodes"][0]["tags"] = json!(["work"]);
    assert!(Portable::from_value(value.clone()).is_err());
    value["schemaVersion"] = json!(3);
    for tags in [
        json!([""]),
        json!([" padded"]),
        json!(["comma,name"]),
        json!(["line\nbreak"]),
        json!(["same", "same"]),
        json!(["x".repeat(41)]),
        json!((0..13).map(|i| format!("tag{i}")).collect::<Vec<_>>()),
    ] {
        value["lists"][0]["nodes"][0]["tags"] = tags;
        assert!(Portable::from_value(value.clone()).is_err());
    }
    value["lists"][0]["nodes"][0]["tags"] = json!(["work", "Work", "Київ", "😀".repeat(40)]);
    assert!(Portable::from_value(value.clone()).is_ok());
    value["schemaVersion"] = json!(4);
    assert!(Portable::from_value(value).is_err());
}
#[tokio::test]
async fn tags_persist_and_copy_with_notes_and_are_never_silently_dropped_by_markdown() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(&dir.path().join("test.sqlite")).await.unwrap();
    let mut source = fixture();
    source["schemaVersion"] = json!(3);
    source["lists"][0]["nodes"][0]["tags"] = json!(["work", "Київ"]);
    let imported = store
        .import_json(Portable::from_value(source).unwrap())
        .await
        .unwrap();
    let document = store.get(&imported[0].id).await.unwrap();
    assert_eq!(document.nodes[0].tags, vec!["work", "Київ"]);
    let exported = store.export_json(Some(&document.id)).await.unwrap();
    assert_eq!(exported.schema_version, 3);
    assert!(transfer::encode(Format::Markdown, &exported).is_err());
    let copy = store
        .import_json(
            transfer::decode(
                Format::Json,
                &transfer::encode(Format::Json, &exported).unwrap().text,
            )
            .unwrap()
            .document,
        )
        .await
        .unwrap();
    assert_eq!(
        store.get(&copy[0].id).await.unwrap().nodes[0].tags,
        document.nodes[0].tags
    );
    let mut changed = exported.lists.into_iter().next().unwrap();
    changed.nodes[0].tags.clear();
    store
        .save(
            &document.id,
            SaveList {
                base_revision: document.revision,
                document: changed,
            },
        )
        .await
        .unwrap();
    assert!(
        store.get(&document.id).await.unwrap().nodes[0]
            .tags
            .is_empty()
    );
    assert!(
        store.export_json(Some(&copy[0].id)).await.unwrap().lists[0].nodes[0]
            .tags
            .len()
            == 2
    );
}

#[tokio::test]
async fn additive_upgrade_from_m7_preserves_notes_content_and_view_preferences() {
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

#[tokio::test]
async fn identical_tag_names_in_different_accounts_do_not_expose_other_lists() {
    use forget_me_not::error::AppError;
    use uuid::Uuid;
    let dir = tempfile::tempdir().unwrap();
    let owner = Store::open(&dir.path().join("owners.sqlite"))
        .await
        .unwrap();
    let foreign_id = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO users(id,display_name,created_at) VALUES (?,'Other user',0)")
        .bind(&foreign_id)
        .execute(&owner.pool)
        .await
        .unwrap();
    let other = Store {
        pool: owner.pool.clone(),
        owner_id: foreign_id,
    };
    let mut value = fixture();
    value["schemaVersion"] = json!(3);
    value["lists"][0]["nodes"][0]["tags"] = json!(["same-tag"]);
    let first = owner
        .import_json(Portable::from_value(value.clone()).unwrap())
        .await
        .unwrap();
    let second = other
        .import_json(Portable::from_value(value).unwrap())
        .await
        .unwrap();
    assert!(matches!(
        owner.get(&second[0].id).await,
        Err(AppError::NotFound)
    ));
    assert!(matches!(
        other.get(&first[0].id).await,
        Err(AppError::NotFound)
    ));
    let exported = owner.export_json(None).await.unwrap();
    assert!(
        exported
            .lists
            .iter()
            .all(|list| second.iter().all(|foreign| foreign.id != list.id))
    );
    assert_eq!(exported.lists[0].nodes[0].tags, vec!["same-tag"]);
}
