# Forget Me Not

A personal, keyboard-driven web outliner with local SQLite persistence. Includes JSON-only import/export, scoped local draft recovery, and explicit conflict handling.

## Run locally

Requirements: Node.js 22.12+ and pnpm 11 on `PATH`, plus a current stable Rust toolchain with Cargo, rustfmt, and Clippy. Verification used Node 26.12.1, pnpm 11.25.0, and Rust 1.99.1. Docker and the SQLx CLI are not required. The development process runner currently targets macOS/Linux.

From the repository root:

```sh
make install
make dev
```

Open http://127.0.0.1:5173. `make dev` starts the Rust API, applies embedded migrations, waits for readiness, then starts Vite with an API proxy. Ctrl+C stops both processes. Occupied ports cause startup to fail rather than silently connect to another server.

The default SQLite file is `data/forget-me-not.sqlite`, excluded from Git. A local user is provisioned once and reused across restarts. New installations start with no lists; choose **New list** to begin. Each list supports a plain-text heading rename, items, tasks, and autosave after a short pause.

**Local use only:** the API binds to IPv4 loopback and checks request Host/Origin. There is no login. Production authentication and Docker deployment are planned for M5.

## Persistence behavior

- Each user can own multiple lists. Choose a list in the sidebar; its ID in the URL restores selection on reload.
- Click the heading to rename. Enter or leaving the field accepts a nonempty name; Escape cancels. An empty name leaves the existing title unchanged.
- Text and tree edits autosave after about 500 ms. A list has only one write in flight; newer edits queue behind it.
- **Saved** means the current snapshot was acknowledged by the server. Unsaved/saving/error/conflict states are explicit, with a sidebar marker for background changes.
- On network failure, local changes remain in the tab. **Retry save** checks server state before repeating a potentially committed write.
- A revision conflict pauses autosave without replacing local text. M4 offers a separate saved copy, server reload with local-draft preservation, and JSON download.
- Undo/redo is session-only and retained separately for each open list. List renames are separate from item history. Deleting a whole list requires confirmation and is permanent; deleting a branch supports undo.
- New lists are empty. Item text currently displays literally; Markdown rendering is not implemented yet.

The API initially sends a complete list snapshot; SQLite updates only changed item rows in one revision-checked transaction. Moving a branch preserves IDs and descendant references.

## Draft recovery and conflicts

Content changes are also written to IndexedDB. **Local draft saved in this browser** confirms the latest local write, separately from server **Saved** status. After reload, choose **Recover drafts** to preview, download, discard, or recover retained content as a new list. Nothing automatically replaces a newer server version. Drafts of a deleted source list can still be recovered.

When autosave reports a conflict/error:

- **Save local as new list** opens a confirmed copy with new IDs, leaving the original server list intact.
- **Load server version** first preserves your local changes as a recoverable draft, then starts a fresh editor history from the server. It refuses to discard local text when draft storage fails.
- **Download local JSON** keeps a portable local version.

Each tab keeps a distinct writer. Drafts are scoped to installation/user inside the browser origin. Initial recovery requires the backend to confirm identity; full offline startup is not included. Browser storage can be cleared or evicted and is not a backup. Storage failures are visible with retry and JSON fallback. See [recovery behavior](docs/recovery.md).

## JSON import and export

Open **Import / export** in the sidebar.

- **Export current list** includes your latest local edits, even when unsaved or conflicted. It does not mark them saved.
- **Export all lists** first flushes pending edits, then exports one consistent snapshot of your saved lists. Errors/conflicts block this action; use current-list export to retain a local version instead.
- Choose a UTF-8 JSON file to preview its titles and list/item counts. No writes happen until **Import as new copies** is confirmed.
- Import creates fresh list/item IDs and keeps existing lists unchanged. All lists in a file are written in one transaction; failure rolls back the entire batch.
- If an import response is lost, the operation may already have completed. It is never automatically retried; use **Refresh list index** to check your lists without discarding local edits before selecting the file again.

Supported format: `schemaVersion: 1` with a `lists` array. Limits are 8 MiB/file, 100 lists, and 10,000 total items, plus existing per-list limits. Unknown fields, newer versions, duplicate IDs, and invalid structures are rejected with explicit errors. See [JSON format](docs/data-formats.md) and the [example file](fixtures/portable-v1.json).

Markdown file import/export is not planned. Markdown-looking text is preserved literally in JSON; safe display rendering inside items is deferred to M11.

## Keyboard editing

- Click an item or use F2 to edit; Escape returns to navigation.
- Enter creates a sibling after the whole branch; Shift+Enter adds a line break.
- Tab / Shift+Tab indent / outdent on item text in navigation and editing. In navigation, Escape focuses the toolbar to resume normal page Tab navigation.
- Alt+↑ / Alt+↓ move a branch among siblings.
- In navigation, arrows move between visible items and expand/collapse branches; Space completes a task.
- Cmd/Ctrl+Z undoes; Cmd/Ctrl+Shift+Z redoes, including text and structural edits.
- Del deletes a branch in navigation mode; in text editing it deletes characters normally.
- Keyboard guide opens a modal dialog; Escape closes it.

## Build, migrate, and verify

```sh
make db-migrate
make check
make test
make build
make run
```

`make run` serves the built frontend and API at http://127.0.0.1:3001. Build the frontend first. `make check` runs Svelte/TypeScript, Prettier, Rust formatting, and Clippy. `make test` runs model/history/autosave tests and disposable SQLite/API integration tests. `make format` formats frontend and Rust files.

Browser tests need Playwright Chromium:

```sh
make browser-install
make test-browser
```

Browser tests start their own frontend/API on ports 5174/3002 and a fresh temporary database; they do not touch `data/forget-me-not.sqlite` or reuse a development server. The runner removes the temporary database on graceful shutdown.

Dependencies are locked in `frontend/pnpm-lock.yaml` and `backend/Cargo.lock`. Migration SQL lives in `backend/migrations/` and is embedded in the backend. Both startup and `make db-migrate` use the same migration runner; applied files must not be edited. Database migration versions, list revisions, and JSON schema versions are independent.

## Configuration

Export variables in the shell; `.env` files are not loaded automatically.

| Variable | Default | Purpose |
| --- | --- | --- |
| `FMN_DB_PATH` | `data/forget-me-not.sqlite` | SQLite file path, relative to the working directory |
| `FMN_PORT` | `3001` | Loopback API / built-app port |
| `FMN_FRONTEND_PORT` | `5173` | Vite development port and allowed frontend origin |
| `FMN_ASSETS_PATH` | `frontend/dist` | Built frontend directory |
| `CARGO`, `PNPM` | `cargo`, `pnpm` | Makefile tool overrides |

Example: `FMN_DB_PATH=/tmp/outline-demo.sqlite make dev`. Normal shutdown never deletes the development database. For backups of a running WAL database, use a consistent SQLite backup operation rather than copying only the main file.

Current limits: 1 MiB per normal save request (8 MiB for JSON import), 2,000 items per list, 32 nesting levels, 32 KiB per item text, and 200 Unicode characters per title. There is no user-driven list reorder yet; lists follow creation order.

See the [code structure](docs/code-structure.md) for module responsibilities and extension points.

See the [documentation](docs/README.md), [milestones](docs/milestones.md), and [M4 implementation record](docs/plans/m4-draft-recovery.md). Working agreements for Codex: [AGENTS.md](AGENTS.md).
