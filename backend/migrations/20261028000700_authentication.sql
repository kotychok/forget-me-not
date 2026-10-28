CREATE TABLE auth_accounts (
    user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    login TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','user')),
    status TEXT NOT NULL CHECK (status IN ('active','disabled')),
    auth_version TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
-- Schema required by tower-sessions-sqlx-store 0.15; owned by SQLx migration history.
CREATE TABLE tower_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    data BLOB NOT NULL,
    expiry_date INTEGER NOT NULL
);
CREATE TABLE auth_grants (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES auth_accounts(user_id) ON DELETE CASCADE,
    auth_version TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX auth_grants_user ON auth_grants(user_id);
CREATE TABLE auth_attempts (
    bucket TEXT PRIMARY KEY NOT NULL,
    started_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL
);
