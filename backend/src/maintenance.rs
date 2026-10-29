//! Local-only backup/restore operations. They never open the source through Store::open.
use crate::{MIGRATOR, Store};
use serde::Serialize;
use sqlx::{
    Connection, Row, SqliteConnection,
    sqlite::{SqliteConnectOptions, SqliteJournalMode},
};
use std::{
    fs::{self, File, OpenOptions},
    path::{Path, PathBuf},
    time::Duration,
};
use uuid::Uuid;
type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub migration_version: i64,
    pub pending_migrations: usize,
    pub users: i64,
    pub lists: i64,
    pub items: i64,
}
async fn connection(path: &Path, readonly: bool) -> Result<SqliteConnection> {
    if !path.is_file() {
        return Err("Database source must be an existing regular file".into());
    }
    Ok(SqliteConnection::connect_with(
        &SqliteConnectOptions::new()
            .filename(path)
            .read_only(readonly)
            .create_if_missing(false)
            .foreign_keys(true)
            .pragma("trusted_schema", "OFF")
            .busy_timeout(Duration::from_secs(15)),
    )
    .await?)
}
/// Read-only physical/integrity and embedded-migration compatibility check. No migrations are applied.
pub async fn verify(path: &Path) -> Result<Report> {
    let mut db = connection(path, true).await?;
    let result = inspect(&mut db).await;
    db.close().await?;
    result
}
async fn inspect(db: &mut SqliteConnection) -> Result<Report> {
    let integrity: Vec<String> = sqlx::query_scalar("PRAGMA integrity_check")
        .fetch_all(&mut *db)
        .await?;
    if integrity != ["ok"] {
        return Err("SQLite integrity check failed".into());
    }
    if !sqlx::query("PRAGMA foreign_key_check")
        .fetch_all(&mut *db)
        .await?
        .is_empty()
    {
        return Err("SQLite foreign key check failed".into());
    }
    let applied =
        sqlx::query("SELECT version,checksum,success FROM _sqlx_migrations ORDER BY version")
            .fetch_all(&mut *db)
            .await?;
    let supported: Vec<_> = MIGRATOR.iter().collect();
    if applied.is_empty() || applied.len() > supported.len() {
        return Err("Unsupported or missing migration history".into());
    }
    for (row, migration) in applied.iter().zip(&supported) {
        if row.try_get::<i64, _>("version")? != migration.version
            || row.try_get::<Vec<u8>, _>("checksum")? != migration.checksum.as_ref()
            || !row.try_get::<bool, _>("success")?
        {
            return Err(
                "Migration history is incomplete, changed, failed or newer than this binary".into(),
            );
        }
    }
    let identity: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM local_identity l JOIN users u ON l.user_id=u.id WHERE l.singleton=1",
    )
    .fetch_one(&mut *db)
    .await?;
    if identity != 1 {
        return Err("Database has no valid local installation owner".into());
    }
    Ok(Report {
        migration_version: applied.last().unwrap().try_get("version")?,
        pending_migrations: supported.len() - applied.len(),
        users: sqlx::query_scalar("SELECT count(*) FROM users")
            .fetch_one(&mut *db)
            .await?,
        lists: sqlx::query_scalar("SELECT count(*) FROM lists")
            .fetch_one(&mut *db)
            .await?,
        items: sqlx::query_scalar("SELECT count(*) FROM items")
            .fetch_one(&mut *db)
            .await?,
    })
}
struct Candidate {
    path: PathBuf,
    destination: PathBuf,
}
impl Candidate {
    fn create(destination: &Path) -> Result<Self> {
        ensure_absent(destination)?;
        let parent = destination
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
            .unwrap_or(Path::new("."));
        let parent = parent.canonicalize()?;
        let name = destination
            .file_name()
            .ok_or("Destination needs a filename")?;
        let destination = parent.join(name);
        let path = parent.join(format!(".fmn-snapshot-{}.sqlite", Uuid::new_v4()));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        options.open(&path)?.sync_all()?;
        Ok(Self { path, destination })
    }
    fn publish(&self) -> Result<()> {
        ensure_absent(&self.destination)?;
        File::open(&self.path)?.sync_all()?;
        // Exclusive publication: hard_link never overwrites an existing target, including a symlink.
        fs::hard_link(&self.path, &self.destination)?;
        #[cfg(unix)]
        File::open(self.destination.parent().unwrap())?.sync_all()?;
        Ok(())
    }
}
fn ensure_absent(path: &Path) -> Result<()> {
    for suffix in ["", "-wal", "-shm", "-journal"] {
        let mut name = path.as_os_str().to_os_string();
        name.push(suffix);
        match fs::symlink_metadata(PathBuf::from(name)) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
            Ok(_) => {
                return Err(
                    "Destination or SQLite sidecar already exists; choose a new path".into(),
                );
            }
        }
    }
    Ok(())
}
impl Drop for Candidate {
    fn drop(&mut self) {
        for suffix in ["", "-wal", "-shm", "-journal"] {
            let mut path = self.path.as_os_str().to_os_string();
            path.push(suffix);
            let _ = fs::remove_file(PathBuf::from(path));
        }
    }
}
async fn snapshot(source: &Path, target: &Path) -> Result<()> {
    let mut db = connection(source, true).await?;
    // Parameter binding avoids interpreting paths as SQL; generated target is an absolute plain filename.
    let result = sqlx::query("VACUUM main INTO ?")
        .bind(target.to_str().ok_or("Destination path must be UTF-8")?)
        .execute(&mut db)
        .await;
    db.close().await?;
    result?;
    Ok(())
}
pub async fn backup(source: &Path, destination: &Path) -> Result<Report> {
    verify(source).await?;
    let candidate = Candidate::create(destination)?;
    snapshot(source, &candidate.path).await?;
    let report = verify(&candidate.path).await?;
    candidate.publish()?;
    Ok(report)
}
/// Restore only to a fresh path; migrate the candidate, invalidate credentials and publish after verification.
pub async fn restore(source: &Path, destination: &Path) -> Result<Report> {
    verify(source).await?;
    let candidate = Candidate::create(destination)?;
    snapshot(source, &candidate.path).await?;
    let store = Store::open(&candidate.path).await?;
    let result: Result<()> = async {
        let mut tx=store.pool.begin().await?;
        sqlx::query("DELETE FROM auth_grants").execute(&mut *tx).await?;
        sqlx::query("DELETE FROM tower_sessions").execute(&mut *tx).await?;
        sqlx::query("DELETE FROM auth_attempts").execute(&mut *tx).await?;
        sqlx::query("UPDATE account_tokens SET revoked_at=? WHERE consumed_at IS NULL AND revoked_at IS NULL").bind(crate::auth::now()).execute(&mut *tx).await?;
        let users: Vec<String>=sqlx::query_scalar("SELECT user_id FROM auth_accounts").fetch_all(&mut *tx).await?;
        for user in users { sqlx::query("UPDATE auth_accounts SET auth_version=? WHERE user_id=?").bind(Uuid::new_v4().to_string()).bind(user).execute(&mut *tx).await?; }
        sqlx::query("UPDATE installation SET id=? WHERE singleton=1").bind(Uuid::new_v4().to_string()).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO account_audit(id,actor_id,target_id,action,created_at) VALUES (?,?,?,'database_restored',?)").bind(Uuid::new_v4().to_string()).bind(&store.owner_id).bind(&store.owner_id).bind(crate::auth::now()).execute(&mut *tx).await?;
        tx.commit().await?; Ok(())
    }.await;
    store.pool.close().await;
    result?;
    // Collapse candidate WAL into a single durable file before exclusive publication.
    let mut db = SqliteConnection::connect_with(
        &SqliteConnectOptions::new()
            .filename(&candidate.path)
            .create_if_missing(false)
            .journal_mode(SqliteJournalMode::Delete),
    )
    .await?;
    let journal: String = sqlx::query_scalar("PRAGMA journal_mode")
        .fetch_one(&mut db)
        .await?;
    db.close().await?;
    if journal != "delete" {
        return Err("Could not finalize restored database journal".into());
    }
    let report = verify(&candidate.path).await?;
    candidate.publish()?;
    Ok(report)
}
