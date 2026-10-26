# JSON data format — schema v1

M3 supports JSON file import/export only. Markdown file import/export is out of scope. Markdown rendering inside item text is deferred to M9; all text is currently literal.

## Portable model

The envelope has exactly two fields: `schemaVersion: 1` and `lists`. Each list has `id`, `title`, and `nodes`. Each nested item has `id`, `kind` (`item` or `task`), `text`, `completed`, and `children`. Arrays preserve list and sibling order. Plain items must have `completed: false`.

IDs are canonical lowercase UUIDv4 strings. List IDs must be unique within a file; item IDs must be unique across all lists in the file. Database rows use parent references; portable files use nested arrays without duplicated parent IDs.

See the [shared schema-v1 fixture](../fixtures/portable-v1.json) for a complete example with multiline Unicode text, literal formatting characters, nested tasks, and an empty list. Both frontend and backend test this fixture.

JSON is a complete portable copy of supported list content, not a backup of the whole installation. Owner identity, account data, server timestamps, revisions, collapse state, cursor/selection, drafts, and undo history are excluded. Database migration versions, list revisions, and `schemaVersion` are independent.

Unknown fields and unsupported schema versions are rejected instead of silently discarded. A future schema migration must explicitly define how older files are read. Tags, dates, and separate notes will require explicit portable-field/schema handling when their milestones are implemented.

## Export

- **Export current list** reads the selected session, preserving its latest local edits even if unsaved or conflicted. Export does not mark those edits saved on the server.
- **Export all lists** flushes the current tab's pending queues first; an error/conflict blocks this action. The server then reads all owned lists in one consistent SQLite transaction, ordered by list position. Changes from other tabs may therefore appear in this saved-data export.
- IDs are preserved in exports. Files use compact UTF-8 JSON and the same envelope for one or multiple lists. Downloads use a sanitized filename and do not include ownership or authentication metadata.
- Exports over the supported file/list/item limits fail explicitly; they never silently omit lists. Export individual lists when a workspace exceeds batch limits.

## Import

1. Select a JSON file. Validate its size, encoding, schema, IDs, and content in the browser.
2. Preview filename, list titles, list count, and total item count. This performs no database writes; closing the dialog cancels without applying it.
3. Confirm **Import as new copies**. The backend validates again and generates fresh IDs for every list and item, even if source IDs do not collide with existing data.
4. Insert all lists and nodes in one transaction, owned by the server-resolved local user. Failure rolls the entire batch back. Existing lists are never modified.

Repeated intentional import creates another set of copies. ID-preserving restore, merge, and overwrite are not implemented. A missing network response is not proof of failure: import is not automatically retried, and the dialog explains that it may have completed. Use **Refresh list index** to check for completed imports without discarding local edits before selecting the file again.

## Limits and errors

| Limit | Value |
| --- | --- |
| File / import request | 8 MiB UTF-8 JSON |
| Lists per file | 1–100 |
| Items across the file | 10,000 |
| Items per list | 2,000 |
| Nesting | 32 item levels |
| Item text | 32 KiB UTF-8 |
| List title | 1–200 Unicode characters, not blank |
| Serialized single-list save request | 1 MiB |

The per-list save limit ensures imported data can still be edited through normal autosave. Validation errors identify a JSON path and reason where possible. Invalid JSON/UTF-8 and oversized files fail before preview. Server validation failures return 422; oversized HTTP bodies return 413; unknown/non-owned export IDs return 404. Backend extraction errors can be plain text, which the API client handles.

## Markdown in item text — later

Literal `**bold**`, links, backticks, or HTML-looking text survive JSON round-trip unchanged today. M9 may add safe Markdown display rendering while keeping the underlying text editable and portable. That is separate from importing Markdown documents or using Markdown as the storage format.
