use super::*;

async fn read_view(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    owner: &str,
    list: &str,
) -> Result<OutlineView> {
    let row: Option<(String, i64)> = sqlx::query_as(
        "SELECT collapsed_item_ids,revision FROM list_view_states WHERE user_id=? AND list_id=?",
    )
    .bind(owner)
    .bind(list)
    .fetch_optional(&mut **tx)
    .await?;
    let (ids, revision) = row.unwrap_or_else(|| ("[]".into(), 0));
    let stored: Vec<String> =
        serde_json::from_str(&ids).map_err(|_| AppError::Corrupt("Invalid stored outline view"))?;
    let valid: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT parent_id FROM items WHERE list_id=? AND parent_id IS NOT NULL",
    )
    .bind(list)
    .fetch_all(&mut **tx)
    .await?;
    let valid: HashSet<_> = valid.into_iter().collect();
    let mut collapsed_item_ids: Vec<_> =
        stored.into_iter().filter(|id| valid.contains(id)).collect();
    collapsed_item_ids.sort();
    collapsed_item_ids.dedup();
    Ok(OutlineView {
        collapsed_item_ids,
        revision,
    })
}
impl Store {
    pub async fn outline_view(&self, id: &str) -> Result<OutlineView> {
        let mut tx = self.pool.begin().await?;
        let owned: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM lists WHERE id=? AND owner_id=?)")
                .bind(id)
                .bind(&self.owner_id)
                .fetch_one(&mut *tx)
                .await?;
        if !owned {
            return Err(AppError::NotFound);
        }
        let view = read_view(&mut tx, &self.owner_id, id).await?;
        tx.commit().await?;
        Ok(view)
    }
    pub async fn patch_outline_view(&self, id: &str, request: PatchView) -> Result<OutlineView> {
        if request.base_revision < 0 || request.changes.len() > crate::validation::MAX_ITEMS {
            return Err(invalid("Invalid outline view revision or changes"));
        }
        for change in &request.changes {
            let parsed =
                Uuid::parse_str(&change.item_id).map_err(|_| invalid("Invalid outline item ID"))?;
            if parsed.get_version_num() != 4 || parsed.to_string() != change.item_id {
                return Err(invalid("Invalid outline item ID"));
            }
        }
        let mut tx = self.pool.begin().await?;
        // A no-op write serializes preference updates without changing list content/revision.
        let owned = sqlx::query("UPDATE lists SET revision=revision WHERE id=? AND owner_id=?")
            .bind(id)
            .bind(&self.owner_id)
            .execute(&mut *tx)
            .await?
            .rows_affected();
        if owned == 0 {
            return Err(AppError::NotFound);
        }
        let current = read_view(&mut tx, &self.owner_id, id).await?;
        if current.revision != request.base_revision {
            return Err(AppError::Conflict);
        }
        let valid: Vec<String> = sqlx::query_scalar(
            "SELECT DISTINCT parent_id FROM items WHERE list_id=? AND parent_id IS NOT NULL",
        )
        .bind(id)
        .fetch_all(&mut *tx)
        .await?;
        let valid: HashSet<_> = valid.into_iter().collect();
        let mut collapsed: HashSet<_> = current.collapsed_item_ids.into_iter().collect();
        for change in request.changes {
            if change.collapsed && valid.contains(&change.item_id) {
                collapsed.insert(change.item_id);
            } else {
                collapsed.remove(&change.item_id);
            }
        }
        let mut collapsed_item_ids: Vec<_> = collapsed.into_iter().collect();
        collapsed_item_ids.sort();
        let revision = current.revision + 1;
        sqlx::query("INSERT INTO list_view_states(user_id,list_id,collapsed_item_ids,revision) VALUES (?,?,?,?) ON CONFLICT(user_id,list_id) DO UPDATE SET collapsed_item_ids=excluded.collapsed_item_ids,revision=excluded.revision")
            .bind(&self.owner_id).bind(id).bind(serde_json::to_string(&collapsed_item_ids).map_err(|_| AppError::Storage)?).bind(revision).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(OutlineView {
            collapsed_item_ids,
            revision,
        })
    }
}
