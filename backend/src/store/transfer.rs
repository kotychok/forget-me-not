use super::*;
use crate::portable::{MAX_FILE_BYTES, MAX_LISTS, MAX_TOTAL_ITEMS, Portable};

impl Store {
    /// Read all requested lists in one SQLite snapshot, scoped to this owner.
    pub async fn export_json(&self, list_id: Option<&str>) -> Result<Portable> {
        let mut tx = self.pool.begin().await?;
        let rows: Vec<ListRow> = if let Some(id) = list_id {
            vec![
                sqlx::query_as("SELECT id,title,revision FROM lists WHERE id=? AND owner_id=?")
                    .bind(id)
                    .bind(&self.owner_id)
                    .fetch_optional(&mut *tx)
                    .await?
                    .ok_or(AppError::NotFound)?,
            ]
        } else {
            sqlx::query_as(
                "SELECT id,title,revision FROM lists WHERE owner_id=? ORDER BY position,id LIMIT ?",
            )
            .bind(&self.owner_id)
            .bind((MAX_LISTS + 1) as i64)
            .fetch_all(&mut *tx)
            .await?
        };
        if rows.len() > MAX_LISTS {
            return Err(AppError::InvalidImport(
                "$.lists: more than 100 lists; export individual lists".into(),
            ));
        }
        let mut lists = Vec::new();
        let mut total_items = 0;
        let mut document_bytes = 0;
        for row in rows {
            let items = sqlx::query_as::<_,ItemRow>("SELECT id,parent_id,position,kind,text,note,completed FROM items WHERE list_id=? ORDER BY position,id").bind(&row.id).fetch_all(&mut *tx).await?;
            total_items += items.len();
            if total_items > MAX_TOTAL_ITEMS {
                return Err(AppError::InvalidImport(
                    "$.lists: more than 10000 items; export individual lists".into(),
                ));
            }
            let document = Document {
                id: row.id,
                title: row.title,
                nodes: build_tree(items)?,
            };
            document_bytes += serde_json::to_vec(&document)
                .map_err(|_| AppError::Storage)?
                .len();
            if document_bytes > MAX_FILE_BYTES {
                return Err(AppError::InvalidImport(
                    "$: export exceeds 8 MiB; export individual lists".into(),
                ));
            }
            lists.push(document);
        }
        tx.commit().await?;
        let result = Portable {
            schema_version: 2,
            lists,
        };
        result.validate()?;
        Ok(result)
    }

    /// Import only new copies. Every list and item is inserted in a single transaction.
    pub async fn import_json(&self, source: Portable) -> Result<Vec<ListSummary>> {
        source.validate()?;
        fn copy_item(mut item: Item) -> Item {
            item.id = Uuid::new_v4().to_string();
            item.children = item.children.into_iter().map(copy_item).collect();
            item
        }
        let mut tx = self.pool.begin().await?;
        // Acquire the SQLite write lock before allocating the batch's list positions.
        sqlx::query("UPDATE users SET display_name=display_name WHERE id=?")
            .bind(&self.owner_id)
            .execute(&mut *tx)
            .await?;
        let start: i64 =
            sqlx::query_scalar("SELECT COALESCE(MAX(position)+1,0) FROM lists WHERE owner_id=?")
                .bind(&self.owner_id)
                .fetch_one(&mut *tx)
                .await?;
        let time = now();
        let mut imported = Vec::new();
        let writes: Result<()> = async {
            for (offset,document) in source.lists.into_iter().enumerate() {
                let document = Document {id:Uuid::new_v4().to_string(),title:document.title,nodes:document.nodes.into_iter().map(copy_item).collect()};
                let nodes = flatten(&document)?;
                let position = start + offset as i64;
                sqlx::query("INSERT INTO lists(id,owner_id,title,position,revision,created_at,updated_at) VALUES (?,?,?,?,0,?,?)")
                    .bind(&document.id).bind(&self.owner_id).bind(&document.title).bind(position).bind(time).bind(time).execute(&mut *tx).await?;
                for row in &nodes {
                    insert_item(&mut tx, &document.id, row, time).await?;
                }
                imported.push(ListSummary {id:document.id,title:document.title,revision:0,position,item_count:nodes.len() as i64});
            }
            Ok(())
        }.await;
        if let Err(error) = writes {
            tx.rollback().await?;
            return Err(error);
        }
        tx.commit().await?;
        Ok(imported)
    }
}
