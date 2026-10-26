# M4 — Draft recovery and conflicts

Status: implemented and verified; awaiting user review. Authorized after the user reviewed and committed M3.

## Scope and defaults

Persist supported unsaved documents in IndexedDB, separately per installation/user and tab/list writer. On startup compare retained drafts with fresh server documents; never automatically replace server content. Provide preview, recover-as-new-list, JSON download, and explicit draft discard. Current conflict actions preserve a local draft before loading the server, or save local content as a new list through M3's atomic import.

No full offline editing, automatic merge, cross-user draft sharing, persistent undo, or authentication. A new additive SQLite migration creates a stable installation identity for browser scoping; original migrations remain unchanged.

## Module plan

Native IndexedDB adapter; serialized draft writer/lifecycle manager; shared document comparison; Workspace coordination; RecoveryPanel UI. The tree model and editor pane do not know about IndexedDB, HTTP, or recovery decisions. Autosave can be paused while explicitly switching to another version.

## Verification plan

Draft write/clear ordering, conditional deletion tokens, scope isolation, acknowledgement reconciliation, and storage failure behavior; installation migration/identity tests; browser reload with an unacknowledged write, two-tab conflict resolution, deleted-source draft recovery, storage failure with JSON fallback, and lost-save response reconciliation. Use disposable test databases and browser contexts only.

## Verification evidence — 2026-10-26

- `make check`: Svelte/TypeScript and Prettier passed without diagnostics; Rust formatting and Clippy passed with warnings denied.
- `make test`: 29 frontend model/autosave/workspace/format/draft tests and 18 SQLite/API integration tests passed.
- `make build`: production frontend and Rust executable built successfully.
- `make test-browser`: all 27 isolated full-stack Chromium scenarios passed, including seven new M4 workflows: reload recovery, two-tab conflict copy, preserved server reload/discard, deleted-source recovery, lost-save acknowledgement, storage failure/JSON fallback/retry, and foreign-scope isolation.
- Verified serialized acknowledgement cleanup, token-based conditional deletion, and identity change followed by a failed read; another identity's records are not exposed.
- Verified migration from the M3 schema with existing owner, list/item IDs, text, completion, and revision preserved. The original migration was not changed.
- A consistent SQLite backup was created locally before restarting the development server with M4. Test databases remain separate from development data.

No new frontend dependencies were added. IndexedDB is native; tree commands and DOM focus code remain independent of recovery storage. Full offline startup, automatic merging, and persistent undo are not implemented. Browser tests cover Chromium on macOS, not every browser's quota/eviction behavior.

The development server is left running at the existing localhost URL for review. Authentication remains M5. No commits were made.

The recovery dialog and preview were visually inspected at 970 × 954 using an isolated browser-only draft. After the development migration, existing users, local identity, list rows, and item rows matched the pre-migration backup exactly. Local documentation links and `git diff --check` passed.
