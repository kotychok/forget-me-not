CREATE TABLE users (
    id TEXT PRIMARY KEY NOT NULL,
    display_name TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE lists (
    id TEXT PRIMARY KEY NOT NULL,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    title TEXT NOT NULL,
    position INTEGER NOT NULL CHECK (position >= 0),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX lists_owner_order ON lists(owner_id, position, id);

CREATE TABLE items (
    id TEXT PRIMARY KEY NOT NULL,
    list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    parent_id TEXT,
    position INTEGER NOT NULL CHECK (position >= 0),
    kind TEXT NOT NULL CHECK (kind IN ('item', 'task')),
    text TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (list_id, id),
    FOREIGN KEY (list_id, parent_id) REFERENCES items(list_id, id)
        ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
    CHECK (parent_id IS NULL OR parent_id <> id),
    CHECK (kind = 'task' OR completed = 0)
);

CREATE INDEX items_tree_order ON items(list_id, parent_id, position, id);

CREATE TABLE local_identity (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT
);

