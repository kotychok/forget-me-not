# Active and archived lists — M15

Authorized 2026-11-03 after agreement on navigation, read-only content, search and portable state. Implementation is for review; user acceptance is pending.

## Behavior

Active and Archive are separate navigation sections on desktop and in the mobile list chooser. Archiving retains the list, item IDs, original position, content and owner-scoped collapse preferences. Restoration returns the list to its original relative position among active lists. New lists are active. Deep links may open either state; the matching section is selected automatically. If no list is specified, prefer an active list, then an archived one.

Archived lists can be read, links opened, notes viewed, and branches collapsed/expanded. Content, title, completion, notes, tags and dates cannot be edited until Restore. Archive is not trash: permanent deletion remains available with the existing explicit confirmation.

Archiving flushes the current list's pending content before changing state and is blocked by unresolved conflicts, title drafts, dialogs and filters. A successful transition creates a new session baseline and clears old undo/redo. Failure preserves local content. Other-device archiving increments the content revision: clean navigation sessions accept it through existing polling; dirty sessions keep local edits and expose conflict recovery. There is no merge or automatic replay through restoration.

## Server and storage

`20261103001100_list_archives.sql` adds `lists.archived`, boolean, default false. Existing rows remain active. `PATCH /api/lists/{id}/archive` accepts `{baseRevision, archived}` and atomically updates only an owned list at that revision, incrementing its content revision. A stale revision conflicts; a foreign/missing list is unavailable. Content PUT/PATCH writes and Telegram capture reject archived lists. Existing same-packet save receipts can still return their original acknowledgements without modifying content.

Archive status is server-authoritative. Content snapshots cannot change it. Ordinary list summaries and documents include it; the full index supports switching sections and observing remote changes. Independent view metadata remains editable and keeps its own revision. SQLite backup/restore includes archive state.

## Search and portability

Search excludes archived lists by default. Include archived enables them and labels results; selecting a result opens the read-only list. Cached local content remains protected by the existing search/refresh rules and limits.

JSON schema v5 adds optional boolean `archived` per list. Missing means active; true is preserved in exports and new-copy imports, and false may be omitted. V1–v4 input upgrades to v5 with active lists and rejects an archive field rather than silently discarding it. Full export includes both sections. Current-list export includes its archive state. IDs are regenerated on import as before. Markdown export of an archived list fails with a clear JSON/Restore alternative because outline Markdown cannot represent this metadata. Markdown imports remain active.

No archive timestamps, manual reordering, trash recovery or automatic archival rules are included.
