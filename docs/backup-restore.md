# SQLite backup and restore

Implemented as local maintenance commands for the first-release verification pass. No Docker, Python runtime or SQLite CLI is required. All commands use the compiled Rust application and the selected FMN_DB_PATH. They do not expose backup operations over HTTP.

## Create and verify

Create the destination directory first, then choose a new filename:

```sh
mkdir -p data/backups
make db-backup FILE=data/backups/before-upgrade.sqlite
make db-verify FILE=data/backups/before-upgrade.sqlite
```

The source defaults to data/forget-me-not.sqlite. Override FMN_DB_PATH when using another installation. Backup reads an existing database without Store::open, migrations or identity provisioning. It uses SQLite VACUUM INTO to create a consistent snapshot, including committed WAL data, while the application may remain running. It does not copy only the main SQLite file. Verification checks SQLite integrity, foreign keys, the local owner and an exact successful prefix of embedded SQLx migration versions/checksums. Reports contain only counts and version information; they do not enumerate private content or credentials.

A backup includes users, password hashes, content, notes/tags/dates, outline preferences, installation metadata, session/access state and audit history at the snapshot time. Content JSON exports are not installation backups. Protect backup files as sensitive data; keep them outside Git or under ignored data/. Retention, encryption and off-host storage depend on the eventual hosting plan and are not automated here.

Both backup and verification refuse a missing source rather than create an empty installation. Unknown/newer/failed/changed/gapped migration history is rejected. A supported older snapshot can be verified without upgrading it; pendingMigrations in the JSON report identifies that case. These are physical/application-schema checks, not a validator for arbitrary untrusted SQLite schemas or every manually corrupted content value.

## Restore to a separate file

```sh
FMN_DB_PATH=data/restored-installation.sqlite make db-restore FILE=data/backups/before-upgrade.sqlite
make db-verify FILE=data/restored-installation.sqlite
```

The new FMN_DB_PATH must not exist, and neither may its -wal/-shm/-journal sidecars. Restore never overwrites the running installation or the backup. It creates a private candidate, applies supported pending migrations only there, retires old access, verifies the result and publishes the new database. Existing content IDs, owners, revisions and saved outline preferences remain intact.

After inspecting the report, stop the old application and start the restored copy deliberately:

```sh
FMN_DB_PATH=data/restored-installation.sqlite make dev
```

Use credentials valid at the snapshot time, or the existing local administrator recovery command with the restored FMN_DB_PATH. Restoring is a point-in-time rollback: password hashes, roles and enabled/disabled status reflect that snapshot, not later account changes. Review restored accounts before exposing an installation. Do not bootstrap an already configured administrator again.

Restore invalidates all browser grants/session records, outstanding activation/reset links and authentication versions. It assigns a new installation ID so old browser drafts cannot silently overlay restored data. Existing password hashes are retained; this is not automatic password rotation. Pending friends need newly issued links. The restored database records a database_restored audit event.

A browser tab opened against the old installation pauses after losing authentication. Even after same-owner login, Workspace checks the installation identity before resuming queues. On mismatch it keeps the old content paused, offers local JSON download and instructs the user to reload. Old browser drafts remain scoped to the old installation; reimporting chosen JSON is an explicit new-copy operation. Requests also pin the initialized installation in X-FMN-Installation; the server rejects a mismatch even when another tab has already supplied a fresh same-owner cookie. Reauthentication cannot retag cached requests. The backend owner header remains an independent cross-account check.

## Publication and failure behavior

Output is written to a random private staging file in the destination directory (mode 0600 on Unix), checked and fsynced, then linked to the final filename without overwriting an existing file or symlink. Parent-directory sync is used on Unix. Restoration finalizes the candidate into a single-file journal state before publication. The ordinary server can reopen it in WAL mode later.

Destination directories must already exist and support local filesystem hard links; do not point another process at the candidate/destination before publication. Insufficient space, invalid source or a collision fails without replacing the source or an existing destination. Normal failures clean staging files. A forced process termination may leave hidden .fmn-snapshot-* artifacts; inspect/remove those only when no maintenance command is running. A final directory-sync failure can report an error after a complete file was linked; verify any existing output before deciding what to remove. Backups themselves are never automatically pruned.

The Makefile accepts FILE through the process environment rather than interpolating it into shell command text. Ordinary paths with spaces/apostrophes are supported. Make still interprets its own variable syntax; for literal dollar/make-expression filenames use the binary with a properly quoted direct argument instead.

Binary equivalents: --backup PATH, --verify-backup PATH, --restore-backup PATH; restore destination is FMN_DB_PATH. The FILE environment bridge uses FMN_BACKUP_FILE. Backup/verify/restore commands run before normal server startup and never bind a network port.

## Evidence

Disposable tests cover a live WAL database with concurrent atomic writes; notes/tags/dates/children and view metadata; restored login and invalid old cookies/links; changed installation scope; an older supported snapshot upgraded only in the candidate; invalid checksums/files, missing sources and existing targets/sidecars; and CLI verification without initializing FMN_DB_PATH. A separate CLI drill exercised all three Makefile targets with a quoted/space-containing filename. No user database was backed up or restored during implementation.

Sources: [SQLite VACUUM INTO](https://www.sqlite.org/lang_vacuum.html#vacuum_with_an_into_clause) documents consistent live snapshots and output-file rules; [SQLite backup overview](https://www.sqlite.org/backup.html) explains alternatives to copying a live database file. Local verification results are recorded in [R1 readiness](plans/r1-release-readiness.md).
