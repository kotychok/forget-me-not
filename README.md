# Forget Me Not

A personal, keyboard-driven web outliner with local SQLite persistence. Includes JSON and outline-Markdown import/export, scoped local draft recovery, and explicit conflict handling.

## Run locally

Requirements: Node.js 22.12+ and pnpm 11 on `PATH`, plus a current stable Rust toolchain with Cargo, rustfmt, and Clippy. Verification used Node 26.12.1, pnpm 11.25.0, and Rust 1.99.1. Docker and the SQLx CLI are not required. The development process runner currently targets macOS/Linux.

From the repository root:

```sh
make install
make auth-bootstrap LOGIN=your-login
make dev
```

Open http://127.0.0.1:5173. `make dev` starts the Rust API, applies embedded migrations, waits for readiness, then starts Vite with an API proxy. Ctrl+C stops both processes. Occupied ports cause startup to fail rather than silently connect to another server.

The default SQLite file is `data/forget-me-not.sqlite`, excluded from Git. A local user is provisioned once and reused across restarts. New installations start with no lists; choose **New list** to begin. Each list supports a plain-text heading rename, items, tasks, and autosave after a short pause.

**Loopback use:** password login and persistent browser sessions are enabled by default. Bootstrap attaches credentials to the existing local owner and preserves their lists. Stop an older dev process before upgrading. Account manages sessions and password changes. Administrators can use Manage people to add friends through single-use activation links; deployment/HTTPS remain M11c. See [Authentication](docs/authentication.md).

## Tags and filtering

Focus an item and press **T**, or choose **Tags**. Apply up to 12 case-sensitive names, separated by commas. Click a tag chip or choose **Filter by tag** to show matches with ancestor context. Structural commands are locked while filtering; **Clear tag filter** or Escape returns to the full tree. Tags save with content, participate in search/recovery, and are preserved in JSON v3. See [Tags and filtering](docs/tags.md).

## Item notes

Focus an item and press **N**, or choose **Note** in the toolbar. Apply commits one undoable change; Cancel/Escape discards the draft. Notes save with list content, are searchable, and are preserved in current JSON exports. Markdown remains literal; outline-Markdown export of lists with notes/tags is refused with a JSON recommendation. See [Item notes](docs/notes.md).

## Remembered outline view

Manual collapsed/expanded branches are remembered in SQLite per user/list and shared across devices. Preferences refresh when opening a list or returning to the window/tab; there is no live push. Search/undo expansion stays temporary. The toolbar shows view sync status and retry; view preferences do not change content revisions or JSON/Markdown files. Wait for acknowledgement before closing; pending preferences are not offline drafts.

## Search

Choose **Search lists** to search list titles and item text across lists, including local edits in open lists. Results show list/ancestor context; opening one reveals and focuses its item. Reopen search to return to the same query, or refresh results explicitly. Search is literal and case-insensitive; it uses existing snapshot limits (100 lists, 10,000 items, 8 MiB) and shows up to 200 results. See [Search behavior](docs/search.md).

## Links and long text

Long HTTP/HTTPS URLs display compactly; separate domain links open the complete address in a new tab. Click item text or use F2 to edit the full original source in a wrapping, automatically growing field. In navigation, L focuses links, Enter opens one, Tab moves between them, and Escape returns to the item. Link detection does not fetch remote content or add Markdown rendering.

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

## Import and export

Open **Import / export** in the sidebar.

- **Export current list** includes your latest local edits, even when unsaved or conflicted. It does not mark them saved.
- **Export all lists** first flushes pending edits, then exports one consistent snapshot of your saved lists. Errors/conflicts block this action; use current-list export to retain a local version instead.
- Choose a UTF-8 JSON or outline-Markdown file to preview its titles, list/item counts, and format notes. No writes happen until **Import as new copies** is confirmed.
- Import creates fresh list/item IDs and keeps existing lists unchanged. All lists in a file are written in one transaction; failure rolls back the entire batch.
- If an import response is lost, the operation may already have completed. It is never automatically retried; use **Refresh list index** to check your lists without discarding local edits before selecting the file again.

JSON format: `schemaVersion: 4` (legacy v1/v2/v3 files are accepted) with a `lists` array. Limits are 8 MiB/file, 100 lists, and 10,000 total items, plus existing per-list limits. Unknown fields, newer versions, duplicate IDs, and invalid structures are rejected with explicit errors. See [JSON format](docs/data-formats.md) and the [example file](fixtures/portable-v1.json).

Outline Markdown import/export is available through the Import / export dialog. Import `.md` files with preview, or select Markdown for current-list export. Top-level paragraphs become root items, indentation defines nesting, and explicit task markers preserve checkboxes. JSON is the full portable format and supports all-list export. Markdown-looking text is preserved literally in JSON; safe display rendering inside items is deferred to M9.

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
| `FMN_AUTH_MODE` | `password` | Password sessions; explicit `local` bypass only before any account exists |
| `FMN_ASSETS_PATH` | `frontend/dist` | Built frontend directory |
| `CARGO`, `PNPM` | `cargo`, `pnpm` | Makefile tool overrides |

Example: `FMN_DB_PATH=/tmp/outline-demo.sqlite make dev`. Normal shutdown never deletes the development database. For backups of a running WAL database, use a consistent SQLite backup operation rather than copying only the main file.

Current limits: 1 MiB per normal save request (8 MiB for JSON import), 5,000 items per list, 32 nesting levels, 32 KiB per item text, 64 KiB per note, 12 tags/item with 40 characters/name, and 200 Unicode characters per title. There is no user-driven list reorder yet; lists follow creation order.

See the [code structure](docs/code-structure.md) for module responsibilities and extension points.

See the [documentation](docs/README.md), [milestones](docs/milestones.md), and [M4 implementation record](docs/plans/m4-draft-recovery.md). Working agreements for Codex: [AGENTS.md](AGENTS.md).

## License

Licensed under the [MIT License](LICENSE).

M10 adds date-only deadlines through the Date action or D in navigation, with local Today/Overdue status and undoable changes. See [Due dates](docs/dates.md). Restart `make dev` after upgrading so the embedded additive migration runs.

Account administration: open **Manage people** after administrator login. New friends set their own password through a single-use 24-hour link, with no public registration or SMTP requirement. See [Account administration](docs/account-administration.md). Restart the backend for the M11a additive migration; existing accounts do not need bootstrapping again.

## Installation backup

`make db-backup FILE=path.sqlite` creates a verified live SQLite snapshot; `make db-verify FILE=path.sqlite` checks it. Restore only to a new file with `FMN_DB_PATH=data/restored.sqlite make db-restore FILE=path.sqlite`. Create destination directories first. Restore retires old sessions/access links and gives the installation a new draft scope. See [backup and restore](docs/backup-restore.md) for the full procedure and point-in-time credential behavior.
