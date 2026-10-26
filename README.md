# Forget Me Not

A personal, keyboard-driven web outliner. Self-hosting and JSON/Markdown import/export are planned; the current M1 prototype runs entirely in the browser.

## Run locally

Requirements: Node.js 22.12 or newer (verified with Node 24) and pnpm 11 on `PATH`. Docker is not required. Versions are locked in `frontend/pnpm-lock.yaml`.

```sh
make install
make dev
```

Open http://127.0.0.1:5173. Stop the server with Ctrl+C. If Node is managed by a version manager, activate it in the shell before running Make.

**Session only:** reload resets all changes. There is no backend, autosave, draft recovery, or import/export yet. M1 displays item text literally; Markdown rendering is not implemented yet.

## Try the editor

- Click an item or use F2 to edit; Escape returns to navigation.
- Enter creates a sibling after the whole branch; Shift+Enter adds a line break.
- Tab / Shift+Tab indent / outdent while editing. In navigation, Tab moves page focus normally.
- Alt+↑ / Alt+↓ move a branch among siblings.
- In navigation, arrows move between visible items and expand/collapse branches; Space completes a task.
- Cmd/Ctrl+Z undoes; Cmd/Ctrl+Shift+Z redoes, including text and structural edits.
- Del deletes a branch in navigation mode; in text editing it deletes characters normally.
- Keyboard guide opens a modal dialog; Escape closes it.
- Use the toolbar and item actions to move, convert, or delete a branch. Deletion can be undone.

The initial sample list is disposable. This milestone provides one list per browser session; user-owned multiple lists arrive in M2.

## Verify

```sh
make check
make test
make build
make browser-install
make test-browser
```

`make check` checks Svelte/TypeScript and formatting. `make test` runs model/history tests. Browser tests use Playwright Chromium; `make browser-install` downloads that browser. `make format` formats frontend sources. `make run` previews an existing production build. `make help` lists commands.

See the [documentation](docs/README.md), [milestones](docs/milestones.md), and [M1 implementation record](docs/plans/m1-local-editor.md). Working agreements for Codex: [AGENTS.md](AGENTS.md).
