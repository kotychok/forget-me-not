# Draft recovery and conflicts

M4 adds local recovery for supported documents without full offline editing or automatic merging.

## Two independent save states

**Saved** means the current document was acknowledged by the server. **Local draft saved in this browser** means the latest unsaved version completed an IndexedDB write. The latter does not mean the server accepted it. IndexedDB is a recovery aid, not a server backup; browser eviction, clearing site data, or an interrupted last transaction can remove local data.

Unsaved content changes enqueue a local draft immediately, independently of the HTTP debounce. Focus, collapse changes, and navigation do not create drafts. Acknowledging an older HTTP request does not clear a newer local edit. Local writes and cleanup are serialized per writer.

## Identity and tab isolation

`GET /api/session` supplies the stable installation ID and server-resolved owner ID. A new additive SQLite migration creates the installation singleton; existing users, lists, item IDs, content, and revisions are preserved.

IndexedDB is isolated by browser origin. Within an origin, records use installation/user scope and a random page/list writer ID. Different tabs therefore retain separate versions rather than overwriting one shared record. Each write also carries a token; cleanup/discard uses a read-and-delete transaction that checks this token, preserving any version changed after preview.

On startup, the app confirms server identity before reading drafts. It compares retained records with fresh server documents. An identical already-acknowledged document can be removed conditionally; other versions remain available for review. Records for deleted source lists also remain recoverable. There is no automatic expiry or cross-owner cleanup.

Authentication remains M11. Switching authenticated accounts must create a fresh Workspace and clear the old UI/session cache before showing another identity. The draft manager clears exposed records before a different scope is read and refuses reuse with active writers. Initial recovery needs a reachable backend to confirm identity; full offline startup is not implemented.

## Recover drafts

Choose **Recover drafts** to inspect retained versions from previous sessions or other tabs on this browser. **Refresh drafts** discovers newly retained records.

- **Preview local content** displays a short excerpt; recovery retains the complete supported document.
- **Recover as new list** uses M3's atomic new-copy import. The title receives a `(recovered)` suffix; item/list IDs are regenerated. The source list is never overwritten.
- **Download draft JSON** exports the supported content independently of server availability in an already-open session.
- **Discard draft** requires confirmation and deletes only the previewed local record, not a server list. If another tab changed that record, discard is refused and the new version is shown.

Successful recovery consumes the retained record only after the new list is saved and loaded. Conditional cleanup keeps a concurrently updated draft. If a copy response is lost, the original local version remains; copy operations are not automatically retried. Refresh/check the list index before retrying to avoid intentionally creating another copy.

## Resolve a current conflict

A stale revision pauses autosave and preserves the local editor state.

- **Save local as new list** saves a `(local copy)` through atomic import, then opens it. The original list remains on the server. Its old editor/history is released only after the copy is confirmed and loaded.
- **Load server version** fetches the current server document, reliably persists the local dirty version first, then replaces the editor with a fresh session/history. The local version remains in **Recover drafts**. This action is refused if local preservation fails.
- **Download local JSON** keeps the current local content without changing the server.
- **Refresh list index** refreshes metadata while preserving cached local editor sessions.

If a source list was deleted elsewhere, loading it will fail without discarding local content; save a separate copy or use JSON export instead.

## Storage and network failures

IndexedDB open/read/write/quota errors are visible independently of server save status. Server autosave can continue. **Retry local storage** reopens storage and retries the latest local state; JSON remains the fallback for supported documents.

HTTP retry reconciles a potentially committed snapshot before resending newer edits. On reload, an exact server match is treated as already saved rather than automatically creating a recovered duplicate. No automatic content merge, public sharing, persistent undo, or background polling is added.

## Modules and verification

`draft-storage.ts` owns native IndexedDB transactions; `drafts.ts` owns scoped lifecycle, write ordering, and token cleanup; `documents.ts` compares content; Workspace coordinates sessions and recovery actions; RecoveryPanel owns browser UI. Editor commands remain independent of recovery and persistence.

Unit/integration/browser tests cover ordering, scopes, token races, quota failures, reload recovery, two-tab conflicts, deleted sources, lost responses, and migration from the M3 database schema. See [M4 implementation](plans/m4-draft-recovery.md).

## Restored installations — R1

Database restoration creates a new installation identity and invalidates old sessions. A paused tab must not replay cached edits into that installation even if owner IDs and revisions match. Same-owner reauthentication checks the initialized identity first; on mismatch keep edits paused, offer local download and require reload. Browser drafts retain their original scope. See [Backup and restore](backup-restore.md).
