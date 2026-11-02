CREATE TABLE incremental_save_receipts (
    receipt_seq INTEGER PRIMARY KEY AUTOINCREMENT,
    installation_id TEXT NOT NULL,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    operation_id TEXT NOT NULL,
    request_hash BLOB NOT NULL CHECK(length(request_hash)=32),
    applied_revision INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    UNIQUE(installation_id,owner_id,list_id,operation_id)
);
CREATE INDEX incremental_receipt_expiry ON incremental_save_receipts(expires_at);
CREATE INDEX incremental_receipt_owner_order ON incremental_save_receipts(owner_id,receipt_seq);
