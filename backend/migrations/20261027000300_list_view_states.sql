CREATE UNIQUE INDEX lists_owner_identity ON lists(owner_id, id);

CREATE TABLE list_view_states (
    user_id TEXT NOT NULL,
    list_id TEXT NOT NULL,
    collapsed_item_ids TEXT NOT NULL DEFAULT '[]',
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    PRIMARY KEY (user_id, list_id),
    FOREIGN KEY (user_id, list_id) REFERENCES lists(owner_id, id) ON DELETE CASCADE
);
