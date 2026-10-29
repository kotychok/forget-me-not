ALTER TABLE auth_accounts ADD COLUMN activated_at INTEGER;
UPDATE auth_accounts SET activated_at=updated_at;
ALTER TABLE auth_accounts ADD COLUMN disabled_by_admin INTEGER NOT NULL DEFAULT 0 CHECK(disabled_by_admin IN (0,1));
UPDATE auth_accounts SET disabled_by_admin=1 WHERE status='disabled';
CREATE TABLE account_tokens (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES auth_accounts(user_id) ON DELETE CASCADE,
    purpose TEXT NOT NULL CHECK(purpose IN ('activate','reset')),
    digest BLOB NOT NULL CHECK(length(digest)=32),
    auth_version TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    consumed_at INTEGER,
    revoked_at INTEGER
);
CREATE INDEX account_tokens_user ON account_tokens(user_id);
CREATE TABLE account_audit (
    id TEXT PRIMARY KEY NOT NULL,
    actor_id TEXT NOT NULL REFERENCES users(id),
    target_id TEXT NOT NULL REFERENCES users(id),
    action TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
