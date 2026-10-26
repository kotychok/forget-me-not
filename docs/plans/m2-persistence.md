# M2 — Persistence and autosave

Status: implemented and verified; awaiting user review. Authorized by the user's request to implement M2.

## Scope and defaults

Rust/Axum API, SQLite/SQLx migrations, server-provisioned local identity, multiple lists, heading-based rename, delete with confirmation, and revision-checked snapshot saves. Native Makefile startup manages both processes. No login, import/export, IndexedDB draft recovery, or public deployment.

Implementation defaults: loopback-only server; a 1 MiB request limit, 2,000 items per list, 32 tree levels, 32 KiB per item, and 200 characters per title. A new list is empty. Deleting a list is permanent after confirmation; branch deletion still supports session undo. List order is creation order with stable integer positions; user-driven list reorder is deferred. Text/structural history is retained per open list during the page session.

## Plan

1. Backend schema, embedded migrations, local identity, validated owner-scoped CRUD, atomic row diffs and revision checks.
2. Frontend API and per-list autosave queues; list selection, creation, heading rename, deletion, save/error/conflict states.
3. Native process runner, Makefile targets, Vite proxy, isolated test database.
4. Backend integration tests, autosave race/retry tests, browser regression/persistence checks, types/format/build verification.
5. Establish module boundaries for UI/workspace/editor/autosave and HTTP/validation/storage, following the user's modularity request.
6. Update documentation with actual commands, evidence, limits, and known gaps.

## Main risks

Partial writes, cross-list ID reuse, stale responses acknowledging newer edits, failed responses after successful writes, and loss of local state when changing lists. Test against disposable databases only; do not reuse the user's development database for browser tests.

## Module boundaries

Followed the user's request to establish modularity during M2. `App.svelte` composes the page; `EditorPane` owns keyboard/DOM behavior; `KeyboardGuide` owns the modal; Workspace manages list sessions; Editor owns commands/history; Autosave owns write ordering; API owns transport. The backend separates HTTP, models, validation, application errors, and SQLite transactions. See [Code structure](../code-structure.md) for the dependency map and extension guidance. No generic repository/plugin framework was introduced.

## Verification evidence — 2026-10-26

- `make check`: Svelte/TypeScript and Prettier passed with no diagnostics; Rust fmt and Clippy passed with warnings denied.
- `make test`: 15 model/autosave/workspace tests and 11 disposable SQLite/API tests passed.
- `make build`: frontend production assets and Rust executable built successfully.
- `make test-browser`: all 14 isolated full-stack Chromium scenarios passed, including heading rename, list deletion confirmation, reload persistence, slow saves, conflicts, and independent histories across list switches.
- Tested serving built assets/API and an actual backend stop/restart with the same temporary SQLite file; saved content and revision were preserved.
- Tested transactional failure of a SQL migration, refusal of unsupported newer schema history, and rollback on deferred foreign-key failure.
- Verified the browser test runner closes ports 5174/3002 and removes its temporary database. The development runner uses ports 5173/3001 and was left running for review.
- The first-run screen was visually inspected at the review viewport without populating the development database with test data.
- Local documentation links, examples, and `git diff --check` passed. No commits were made.

Runtime: Node 26.12.1, pinned pnpm 11.25.0, temporary isolated Rust 1.99.1 toolchain. SQLx 0.8.6 and all transitive Rust versions are locked in Cargo.lock. No global Rust/shell configuration was changed; future native starts require a Rust toolchain on PATH. Test databases and downloaded browser binaries were kept separate from development data.

## Remaining boundaries

Authentication and deployment remain M5. JSON/Markdown import/export remains M3. IndexedDB drafts and full conflict recovery remain M4; M2 pauses a conflicted queue and keeps local text only in the current tab. Unacknowledged changes can be lost on reload despite the unload warning. User-driven list ordering and trash/soft-delete recovery are not implemented. Collapse state and undo/redo remain session-only. Browser verification used Chromium on macOS; real OS IME and other browser/platform combinations still need manual testing.
