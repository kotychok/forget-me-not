use super::*;
/// Append in the caller's write transaction: deduplication, revision and item commit together.
impl Store {
    pub(crate) async fn append_capture(
        tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
        owner: &str,
        list: &str,
        text: &str,
    ) -> Result<String> {
        let row: Option<ListRow> =
            sqlx::query_as("SELECT id,title,revision FROM lists WHERE id=? AND owner_id=?")
                .bind(list)
                .bind(owner)
                .fetch_optional(&mut **tx)
                .await?;
        let row = row.ok_or(AppError::NotFound)?;
        let rows = sqlx::query_as::<_, ItemRow>("SELECT id,parent_id,position,kind,text,note,tags,due_date,completed FROM items WHERE list_id=? ORDER BY position,id")
            .bind(list).fetch_all(&mut **tx).await?;
        let mut document = Document {
            id: list.into(),
            title: row.title,
            nodes: build_tree(rows)?,
        };
        let id = Uuid::new_v4().to_string();
        document.nodes.push(Item {
            id: id.clone(),
            kind: "item".into(),
            text: text.into(),
            note: String::new(),
            tags: vec![],
            due_date: None,
            completed: false,
            children: vec![],
        });
        let flat = flatten(&document)?;
        if serde_json::to_vec(&document)
            .map_err(|_| AppError::Storage)?
            .len()
            > 1024 * 1024 - 256
        {
            return Err(invalid("Inbox list is too large. Choose another list."));
        }
        let item = flat
            .iter()
            .find(|row| row.id == id)
            .ok_or(AppError::Storage)?;
        let time = now();
        insert_item(tx, list, item, time).await?;
        sqlx::query("UPDATE lists SET revision=revision+1,updated_at=? WHERE id=? AND owner_id=?")
            .bind(time)
            .bind(list)
            .bind(owner)
            .execute(&mut **tx)
            .await?;
        Ok(id)
    }
}
