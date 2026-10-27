# M6b — Shared outline view state

Status: complete; implemented, verified, and accepted by the user on 2026-10-27. Authorized after the user committed and reviewed the preceding work on 2026-10-27.

## Defaults and boundaries

Persist only manual collapsed branch IDs per server-resolved owner/list. All other branches default to expanded. Search, undo and structural-command expansion stays temporary in the browser and does not write view preferences. The JSON/Markdown portable schema, list content revision, and editor history are unchanged.

A new additive migration creates `list_view_states(user_id,list_id,collapsed_item_ids,revision)`. Its composite FK references the owned list identity and cascades on deletion. Existing migrations remain immutable. HTTP GET/PATCH `/api/lists/:id/view` uses the existing owner resolution/Host/Origin boundary. Store validates canonical UUIDv4 change IDs, limits request count, checks ownership, serializes writes, and compares the independent view revision. It filters IDs to current branches; stale/deleted/foreign/leaf IDs cannot enter returned preferences. GET is read-only; a subsequent PATCH prunes stale stored IDs.

`OutlineState` is a small queue independent of Editor, content Autosave, DOM, and file transfer. Manual commands apply locally immediately, coalesce for 400 ms, and send only changed item IDs with desired booleans. On 409 it reads the latest view, overlays pending local commands and retries up to three attempts. Different branches merge; for the same branch the last successful command wins. Sequence checks prevent an old response from discarding a newer command. Lost replies remain safe to retry because commands set a boolean rather than toggle it. Errors stay visible with Retry view sync; local editing remains available.

Workspace owns a manager per cached list session, retaining it when a server document replaces the same session. New imported/recovered/copy lists start with their own default preferences. Pending preferences participate in the existing page-unload warning. They are not durable offline drafts; closing before acknowledgement can lose them. If an unsaved new branch is being collapsed, the queued preference write first flushes existing content edits so the server can validate its ID. A content save failure/conflict leaves preferences local with an explicit retryable error; collapse does not mark content dirty itself.

On opening a list and on visible window focus/visibility return, refresh view preferences asynchronously. There is no polling, SSE, WebSocket, or immediate push between devices. Cached pending local commands overlay a remote refresh. EditorPane applies changed manual preference IDs without stealing focus; it temporarily reveals ancestors of the active item so remote changes cannot unmount a focused textarea. Its local temporary expansion remains distinct from the saved preference set.

## Verification plan

Pure queue tests for concurrent devices, same-branch ordering, newer edits during a save, and lost replies; SQLite tests for independent revisions, pruning, ownership, deletion cascade, no export leakage, and upgrade from the M6a schema without changing content/identity. Browser tests use independent browser contexts for persistence/refresh and concurrent branch changes, search expansion without persistence, network failure/retry, and focused-editor safety. Run the existing editor, draft, transfer, and search suites against disposable data only.

## Verification evidence — 2026-10-27

- `make check` passed: Svelte/TypeScript and Prettier without diagnostics; Rust formatting and Clippy with warnings denied.
- `make test` passed: 42 frontend tests and 26 Rust tests. Queue tests verify concurrent-device rebase, same-branch ordering, edits during in-flight save, and lost replies. SQLite tests verify independent revisions, owner isolation, stale-ID filtering, deletion cascade, no export leakage, and an additive M6a-to-M6b upgrade preserving content, IDs, revision, owner, installation identity, and foreign-key integrity.
- All 40 isolated full-stack browser tests passed, including two new workflows with independent browser contexts: remembered state/reload, visibility refresh, concurrent changes to different branches, temporary search expansion, read/write failures with retry, and focused textarea safety.
- After making preference refresh non-blocking and toolbar clearance dynamic, the four relevant view/search/scroll browser scenarios passed again. Final frontend type/format checks and production build passed.
- A 390-pixel view with saved collapsed branches was visually inspected. Toolbar clearance follows its actual height, including wrapped controls and the view-status row.
- `make build` passed for frontend and backend. Tests used disposable data only; no development database was opened/migrated by the agent, and no long-running development server was started.

Restart `make dev` to apply the additive migration to the user's database and load the new routes. No commits were made.
