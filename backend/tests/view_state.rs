use forget_me_not::{
    Document, Item, SaveList, Store,
    error::AppError,
    model::{PatchView, ViewChange},
};
use uuid::Uuid;
fn node(text: &str, children: Vec<Item>) -> Item {
    Item {
        id: Uuid::new_v4().to_string(),
        note: String::new(),
        tags: vec![],
        kind: "item".into(),
        text: text.into(),
        completed: false,
        children,
    }
}
fn patch(revision: i64, id: &str, collapsed: bool) -> PatchView {
    PatchView {
        base_revision: revision,
        changes: vec![ViewChange {
            item_id: id.into(),
            collapsed,
        }],
    }
}
#[tokio::test]
async fn preferences_persist_without_changing_content_revision_and_are_pruned_after_deletion() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("test.sqlite");
    let store = Store::open(&path).await.unwrap();
    let list = store.create("View".into()).await.unwrap();
    let root = node("Parent", vec![node("Child", vec![])]);
    store
        .save(
            &list.id,
            SaveList {
                base_revision: 0,
                document: Document {
                    id: list.id.clone(),
                    title: list.title.clone(),
                    nodes: vec![root.clone()],
                },
            },
        )
        .await
        .unwrap();
    assert_eq!(store.outline_view(&list.id).await.unwrap().revision, 0);
    let result = store
        .patch_outline_view(&list.id, patch(0, &root.id, true))
        .await
        .unwrap();
    assert_eq!(result.collapsed_item_ids, vec![root.id.clone()]);
    assert_eq!(store.get(&list.id).await.unwrap().revision, 1);
    assert!(matches!(
        store
            .patch_outline_view(&list.id, patch(0, &root.id, false))
            .await,
        Err(AppError::Conflict)
    ));
    let reopened = Store::open(&path).await.unwrap();
    assert_eq!(
        reopened
            .outline_view(&list.id)
            .await
            .unwrap()
            .collapsed_item_ids,
        vec![root.id]
    );
    let exported = store.export_json(None).await.unwrap();
    assert!(
        !serde_json::to_string(&exported)
            .unwrap()
            .contains("collapsed")
    );
    let copy = store.import_json(exported).await.unwrap();
    assert!(
        store
            .outline_view(&copy[0].id)
            .await
            .unwrap()
            .collapsed_item_ids
            .is_empty()
    );
    store
        .save(
            &list.id,
            SaveList {
                base_revision: 1,
                document: Document {
                    id: list.id.clone(),
                    title: list.title.clone(),
                    nodes: vec![],
                },
            },
        )
        .await
        .unwrap();
    assert!(
        store
            .outline_view(&list.id)
            .await
            .unwrap()
            .collapsed_item_ids
            .is_empty()
    );
    store.delete(&list.id, 2).await.unwrap();
    let rows: i64 = sqlx::query_scalar("SELECT count(*) FROM list_view_states WHERE list_id=?")
        .bind(&list.id)
        .fetch_one(&store.pool)
        .await
        .unwrap();
    assert_eq!(rows, 0);
}
#[tokio::test]
async fn foreign_owners_cannot_read_or_write_preferences_and_migration_preserves_existing_lists() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(&dir.path().join("test.sqlite")).await.unwrap();
    let list = store.create("Owned".into()).await.unwrap();
    let foreign = Uuid::new_v4().to_string();
    sqlx::query("INSERT INTO users(id,display_name,created_at) VALUES (?,'Foreign',0)")
        .bind(&foreign)
        .execute(&store.pool)
        .await
        .unwrap();
    sqlx::query("UPDATE lists SET owner_id=? WHERE id=?")
        .bind(&foreign)
        .bind(&list.id)
        .execute(&store.pool)
        .await
        .unwrap();
    assert!(matches!(
        store.outline_view(&list.id).await,
        Err(AppError::NotFound)
    ));
    assert!(matches!(
        store
            .patch_outline_view(&list.id, patch(0, &Uuid::new_v4().to_string(), true))
            .await,
        Err(AppError::NotFound)
    ));
}

#[tokio::test]
async fn additive_upgrade_from_m6a_preserves_content_and_installation_identity() {
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    let dir = tempfile::tempdir().unwrap();
    let migrations = dir.path().join("old-migrations");
    std::fs::create_dir(&migrations).unwrap();
    std::fs::write(
        migrations.join("20261026000100_initial_schema.sql"),
        include_str!("../migrations/20261026000100_initial_schema.sql"),
    )
    .unwrap();
    std::fs::write(
        migrations.join("20261026000200_installation_identity.sql"),
        include_str!("../migrations/20261026000200_installation_identity.sql"),
    )
    .unwrap();
    let path = dir.path().join("upgrade.sqlite");
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
    let list = Uuid::new_v4().to_string();
    let installation = Uuid::new_v4().to_string();
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
    sqlx::query("INSERT INTO lists VALUES (?,?,'Existing list',0,7,1,2)")
        .bind(&list)
        .bind(&owner)
        .execute(&pool)
        .await
        .unwrap();
    let item = node("Existing content", vec![]);
    sqlx::query("INSERT INTO items(id,list_id,parent_id,position,kind,text,completed,created_at,updated_at) VALUES (?,?,NULL,0,'item',?,0,1,2)")
        .bind(&item.id)
        .bind(&list)
        .bind(&item.text)
        .execute(&pool)
        .await
        .unwrap();
    pool.close().await;
    let store = Store::open(&path).await.unwrap();
    assert_eq!(store.identity().await.unwrap().server_id, installation);
    assert_eq!(store.owner_id, owner);
    let current = store.get(&list).await.unwrap();
    assert_eq!(current.revision, 7);
    assert_eq!(current.nodes, vec![item]);
    assert_eq!(store.outline_view(&list).await.unwrap().revision, 0);
    let violations = sqlx::query("PRAGMA foreign_key_check")
        .fetch_all(&store.pool)
        .await
        .unwrap();
    assert!(violations.is_empty());
}
