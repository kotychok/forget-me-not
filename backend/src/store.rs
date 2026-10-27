mod transfer;
mod view_state;
use crate::{
    error::{AppError, Result, invalid},
    model::*,
    validation::{MAX_DEPTH, flatten, validate_title},
};
use sqlx::{
    FromRow, SqlitePool,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
};
use std::{
    collections::{HashMap, HashSet},
    path::Path as FsPath,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;
pub static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
#[derive(FromRow)]
struct ListRow {
    id: String,
    title: String,
    revision: i64,
}
#[derive(FromRow, Debug)]
struct ItemRow {
    id: String,
    parent_id: Option<String>,
    position: i64,
    kind: String,
    text: String,
    note: String,
    completed: bool,
}
fn build_tree(rows: Vec<ItemRow>) -> Result<Vec<Item>> {
    let count = rows.len();
    let mut children: HashMap<Option<String>, Vec<ItemRow>> = HashMap::new();
    for row in rows {
        children.entry(row.parent_id.clone()).or_default().push(row);
    }
    for group in children.values_mut() {
        group.sort_by(|a, b| (a.position, &a.id).cmp(&(b.position, &b.id)));
    }
    fn take(
        parent: Option<String>,
        groups: &mut HashMap<Option<String>, Vec<ItemRow>>,
        depth: usize,
        visited: &mut usize,
    ) -> Result<Vec<Item>> {
        if depth > MAX_DEPTH + 1 {
            return Err(AppError::Corrupt("Stored tree exceeds depth limit"));
        }
        let mut result = Vec::new();
        for row in groups.remove(&parent).unwrap_or_default() {
            *visited += 1;
            let nodes = take(Some(row.id.clone()), groups, depth + 1, visited)?;
            result.push(Item {
                id: row.id,
                kind: row.kind,
                text: row.text,
                note: row.note,
                completed: row.completed,
                children: nodes,
            });
        }
        Ok(result)
    }
    let mut visited = 0;
    let tree = take(None, &mut children, 1, &mut visited)?;
    if visited != count {
        return Err(AppError::Corrupt("Stored tree is invalid"));
    }
    Ok(tree)
}

#[derive(Clone)]
pub struct Store {
    pub pool: SqlitePool,
    pub owner_id: String,
}
impl Store {
    pub async fn open(
        path: &FsPath,
    ) -> std::result::Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
            std::fs::create_dir_all(parent)?;
        }
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .foreign_keys(true)
            .journal_mode(SqliteJournalMode::Wal)
            .busy_timeout(Duration::from_secs(5));
        let pool = SqlitePoolOptions::new()
            .max_connections(4)
            .connect_with(options)
            .await?;
        MIGRATOR.run(&pool).await?;
        // Start with a write to serialize competing first-start identity provisioning.
        let candidate_id = Uuid::new_v4().to_string();
        let mut tx = pool.begin().await?;
        sqlx::query("INSERT OR IGNORE INTO users(id, display_name, created_at) SELECT ?, 'Local user', ? WHERE NOT EXISTS (SELECT 1 FROM local_identity)")
            .bind(&candidate_id).bind(now()).execute(&mut *tx).await?;
        sqlx::query("INSERT OR IGNORE INTO local_identity(singleton, user_id) SELECT 1, id FROM users WHERE id=?").bind(&candidate_id).execute(&mut *tx).await?;
        sqlx::query("INSERT OR IGNORE INTO installation(singleton,id) VALUES (1,?)")
            .bind(Uuid::new_v4().to_string())
            .execute(&mut *tx)
            .await?;
        let owner_id = sqlx::query_scalar("SELECT user_id FROM local_identity WHERE singleton=1")
            .fetch_one(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(Self { pool, owner_id })
    }
    pub async fn identity(&self) -> Result<crate::model::ClientIdentity> {
        let server_id = sqlx::query_scalar("SELECT id FROM installation WHERE singleton=1")
            .fetch_one(&self.pool)
            .await?;
        Ok(crate::model::ClientIdentity {
            server_id,
            owner_id: self.owner_id.clone(),
        })
    }
    pub async fn lists(&self) -> Result<Vec<ListSummary>> {
        Ok(sqlx::query_as("SELECT l.id,l.title,l.revision,l.position,(SELECT count(*) FROM items i WHERE i.list_id=l.id) AS item_count FROM lists l WHERE owner_id=? ORDER BY position,id").bind(&self.owner_id).fetch_all(&self.pool).await?)
    }
    pub async fn create(&self, title: String) -> Result<ListDocument> {
        validate_title(&title)?;
        let id = Uuid::new_v4().to_string();
        let time = now();
        sqlx::query("INSERT INTO lists(id,owner_id,title,position,revision,created_at,updated_at) SELECT ?,?,?,COALESCE(MAX(position)+1,0),0,?,? FROM lists WHERE owner_id=?")
            .bind(&id).bind(&self.owner_id).bind(&title).bind(time).bind(time).bind(&self.owner_id).execute(&self.pool).await?;
        Ok(ListDocument {
            id,
            title,
            revision: 0,
            nodes: vec![],
        })
    }
    pub async fn get(&self, id: &str) -> Result<ListDocument> {
        let mut tx = self.pool.begin().await?;
        let row: ListRow =
            sqlx::query_as("SELECT id,title,revision FROM lists WHERE id=? AND owner_id=?")
                .bind(id)
                .bind(&self.owner_id)
                .fetch_optional(&mut *tx)
                .await?
                .ok_or(AppError::NotFound)?;
        let items = sqlx::query_as::<_,ItemRow>("SELECT id,parent_id,position,kind,text,note,completed FROM items WHERE list_id=? ORDER BY position,id").bind(id).fetch_all(&mut *tx).await?;
        tx.commit().await?;
        Ok(ListDocument {
            id: row.id,
            title: row.title,
            revision: row.revision,
            nodes: build_tree(items)?,
        })
    }
    pub async fn save(&self, id: &str, request: SaveList) -> Result<i64> {
        if id != request.document.id || request.base_revision < 0 {
            return Err(invalid("Invalid save identity or revision"));
        }
        let flat = flatten(&request.document)?;
        let time = now();
        let mut tx = self.pool.begin().await?;
        // Acquire the write lock and check ownership/revision before reading item rows.
        let updated = sqlx::query("UPDATE lists SET title=?,revision=revision+1,updated_at=? WHERE id=? AND owner_id=? AND revision=?")
            .bind(&request.document.title).bind(time).bind(id).bind(&self.owner_id).bind(request.base_revision).execute(&mut *tx).await?.rows_affected();
        if updated == 0 {
            let exists: bool =
                sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM lists WHERE id=? AND owner_id=?)")
                    .bind(id)
                    .bind(&self.owner_id)
                    .fetch_one(&mut *tx)
                    .await?;
            tx.rollback().await?;
            return Err(if exists {
                AppError::Conflict
            } else {
                AppError::NotFound
            });
        }
        let old: Vec<ItemRow> = sqlx::query_as(
            "SELECT id,parent_id,position,kind,text,note,completed FROM items WHERE list_id=?",
        )
        .bind(id)
        .fetch_all(&mut *tx)
        .await?;
        let old: HashMap<_, _> = old.into_iter().map(|row| (row.id.clone(), row)).collect();
        let ids: HashSet<_> = flat.iter().map(|row| row.id.as_str()).collect();
        // Explicit rollback on any statement error; commit errors are handled below too.
        let writes: Result<()> = async {
            for row in &flat {
                if let Some(before) = old.get(&row.id) {
                    if before.parent_id != row.parent_id || before.position != row.position || before.kind != row.kind || before.text != row.text || before.note != row.note || before.completed != row.completed {
                        sqlx::query("UPDATE items SET parent_id=?,position=?,kind=?,text=?,note=?,completed=?,updated_at=? WHERE id=? AND list_id=?")
                            .bind(&row.parent_id).bind(row.position).bind(&row.kind).bind(&row.text).bind(&row.note).bind(row.completed).bind(time).bind(&row.id).bind(id).execute(&mut *tx).await?;
                    }
                } else {
                    let collision: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM items WHERE id=?)").bind(&row.id).fetch_one(&mut *tx).await?;
                    if collision { return Err(invalid("An item ID belongs to another list")); }
                    insert_item(&mut tx, id, row, time).await?;
                }
            }
            for key in old.keys().filter(|key| !ids.contains(key.as_str())) {
                sqlx::query("DELETE FROM items WHERE id=? AND list_id=?").bind(key).bind(id).execute(&mut *tx).await?;
            }
            Ok(())
        }.await;
        if let Err(error) = writes {
            tx.rollback().await?;
            return Err(error);
        }
        // SQLx transaction Drop rolls back if COMMIT fails, including deferred FK errors.
        tx.commit().await?;
        Ok(request.base_revision + 1)
    }
    pub async fn delete(&self, id: &str, revision: i64) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        let result = sqlx::query("DELETE FROM lists WHERE id=? AND owner_id=? AND revision=?")
            .bind(id)
            .bind(&self.owner_id)
            .bind(revision)
            .execute(&mut *tx)
            .await?;
        if result.rows_affected() == 0 {
            let exists: bool =
                sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM lists WHERE id=? AND owner_id=?)")
                    .bind(id)
                    .bind(&self.owner_id)
                    .fetch_one(&mut *tx)
                    .await?;
            tx.rollback().await?;
            return Err(if exists {
                AppError::Conflict
            } else {
                AppError::NotFound
            });
        }
        tx.commit().await?;
        Ok(())
    }
}

async fn insert_item(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    list_id: &str,
    row: &crate::validation::FlatItem,
    time: i64,
) -> Result<()> {
    sqlx::query("INSERT INTO items(id,list_id,parent_id,position,kind,text,note,completed,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .bind(&row.id).bind(list_id).bind(&row.parent_id).bind(row.position).bind(&row.kind).bind(&row.text).bind(&row.note).bind(row.completed).bind(time).bind(time).execute(&mut **tx).await?;
    Ok(())
}
