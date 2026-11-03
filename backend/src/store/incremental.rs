use super::*;
use crate::incremental::{Acknowledgement, Batch, fail};
use sqlx::{Sqlite, Transaction};
use subtle::ConstantTimeEq;
impl Store {
    pub async fn save_incremental(&self, id: &str, batch: &Batch) -> Result<Acknowledgement> {
        if !crate::validation::valid_id(id) {
            return Err(fail("invalid_batch", "Invalid list ID"));
        }
        batch.validate()?;
        let hash = batch.hash(id)?;
        let mut tx = self.pool.begin().await?;
        let result = self.apply_incremental(&mut tx, id, batch, hash).await;
        match result {
            Ok(ack) => {
                tx.commit().await?;
                Ok(ack)
            }
            Err(error) => {
                tx.rollback().await?;
                Err(error)
            }
        }
    }
    async fn apply_incremental(
        &self,
        tx: &mut Transaction<'_, Sqlite>,
        id: &str,
        batch: &Batch,
        hash: Vec<u8>,
    ) -> Result<Acknowledgement> {
        let exists =
            sqlx::query("UPDATE lists SET updated_at=updated_at WHERE id=? AND owner_id=?")
                .bind(id)
                .bind(&self.owner_id)
                .execute(&mut **tx)
                .await?
                .rows_affected();
        if exists == 0 {
            return Err(fail("list_not_found", "List not found"));
        }
        let installation: String =
            sqlx::query_scalar("SELECT id FROM installation WHERE singleton=1")
                .fetch_one(&mut **tx)
                .await?;
        let now = crate::auth::now();
        let receipt:Option<(Vec<u8>,i64)>=sqlx::query_as("SELECT request_hash,applied_revision FROM incremental_save_receipts WHERE installation_id=? AND owner_id=? AND list_id=? AND operation_id=? AND expires_at>?")
                .bind(&installation).bind(&self.owner_id).bind(id).bind(&batch.operation_id).bind(now).fetch_optional(&mut **tx).await?;
        if let Some((before, revision)) = receipt {
            if !bool::from(before.ct_eq(&hash)) {
                return Err(fail(
                    "operation_id_reused",
                    "Operation ID was already used for a different packet",
                ));
            }
            return Ok(Acknowledgement {
                protocol_version: 1,
                operation_id: batch.operation_id.clone(),
                revision,
            });
        }
        let row: ListRow = sqlx::query_as(
            "SELECT id,title,revision,archived FROM lists WHERE id=? AND owner_id=?",
        )
        .bind(id)
        .bind(&self.owner_id)
        .fetch_one(&mut **tx)
        .await?;
        if row.archived {
            return Err(fail(
                "revision_conflict",
                "List is archived; restore it before editing",
            ));
        }
        if row.revision != batch.base_revision {
            return Err(fail("revision_conflict", "List changed on the server"));
        }
        let rows=sqlx::query_as::<_,ItemRow>("SELECT id,parent_id,position,kind,text,note,tags,due_date,completed FROM items WHERE list_id=? ORDER BY position,id").bind(id).fetch_all(&mut **tx).await?;
        let target = batch.apply(Document {
            archived: false,
            id: id.into(),
            title: row.title,
            nodes: build_tree(rows)?,
        })?;
        for created in batch.create_ids() {
            let taken: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM items WHERE id=?)")
                .bind(created)
                .fetch_one(&mut **tx)
                .await?;
            if taken {
                return Err(fail("invalid_batch", "Created item ID is not new"));
            }
        }
        let revision = self
            .write_document(tx, id, &target, batch.base_revision)
            .await?;
        sqlx::query("DELETE FROM incremental_save_receipts WHERE expires_at<=?")
            .bind(now)
            .execute(&mut **tx)
            .await?;
        sqlx::query("INSERT INTO incremental_save_receipts(installation_id,owner_id,list_id,operation_id,request_hash,applied_revision,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)")
                .bind(installation).bind(&self.owner_id).bind(id).bind(&batch.operation_id).bind(hash).bind(revision).bind(now).bind(now+86400).execute(&mut **tx).await?;
        sqlx::query("DELETE FROM incremental_save_receipts WHERE owner_id=? AND receipt_seq NOT IN (SELECT receipt_seq FROM incremental_save_receipts WHERE owner_id=? ORDER BY receipt_seq DESC LIMIT 10000)")
                .bind(&self.owner_id).bind(&self.owner_id).execute(&mut **tx).await?;
        Ok(Acknowledgement {
            protocol_version: 1,
            operation_id: batch.operation_id.clone(),
            revision,
        })
    }
    pub async fn expire_save_receipts(&self) -> Result<()> {
        sqlx::query("DELETE FROM incremental_save_receipts WHERE expires_at<=?")
            .bind(crate::auth::now())
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}
