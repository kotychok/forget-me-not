CREATE TABLE telegram_links (
    bot_id INTEGER NOT NULL,
    digest BLOB NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    auth_version TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    PRIMARY KEY (bot_id, digest),
    UNIQUE (bot_id, user_id)
);
CREATE TABLE telegram_connections (
    bot_id INTEGER NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    telegram_id INTEGER NOT NULL,
    list_id TEXT REFERENCES lists(id) ON DELETE SET NULL,
    auth_version TEXT NOT NULL,
    linked_at INTEGER NOT NULL,
    PRIMARY KEY (bot_id, user_id),
    UNIQUE (bot_id, telegram_id)
);
CREATE TABLE telegram_pollers (
    bot_id INTEGER PRIMARY KEY NOT NULL,
    next_offset INTEGER NOT NULL DEFAULT 0,
    lease_owner TEXT NOT NULL DEFAULT '',
    lease_until INTEGER NOT NULL DEFAULT 0
);
-- Durable receipts contain only generic replies/links, never incoming message text or link secrets.
CREATE TABLE telegram_receipts (
    bot_id INTEGER NOT NULL,
    update_id INTEGER NOT NULL,
    chat_id INTEGER NOT NULL,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    auth_version TEXT,
    reply TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    retry_at INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (bot_id, update_id)
);
CREATE TABLE telegram_rates (
    bot_id INTEGER NOT NULL,
    chat_id INTEGER NOT NULL,
    bucket INTEGER NOT NULL,
    count INTEGER NOT NULL,
    PRIMARY KEY (bot_id, chat_id, bucket)
);
