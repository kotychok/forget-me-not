# Working agreements

- Use English for repository content, including documentation, comments, and code identifiers. Continue chatting with the user in Ukrainian unless requested otherwise.
- The user makes commits. Do not commit, amend, push, or publish without a separate explicit request. Do not initialize Git on your own.
- M3 implementation is authorized: JSON-only import/export with preview and atomic new-copy imports. Markdown file import/export is out of scope; Markdown rendering in item text is deferred to M11. Login and draft recovery remain M5/M4. Preserve the established module boundaries.
- Distinguish agreed requirements, proposals, and open questions. Do not treat assumptions as approved decisions.
- Use `docs/architecture.md` for component boundaries, `docs/editor-behavior.md` for editor commands, `docs/data-formats.md` for formats, and `docs/database.md` for schema and migrations. Read only the documents relevant to the task.
- Record significant architecture decisions and changes to agreements in `docs/decisions.md`. Keep the current direction and questions in `docs/README.md`; use `docs/milestones.md` for roadmap status and acceptance criteria.
- Support native local execution without Docker and container deployment. Makefile is the common entry point for running, building, and checking; native execution must not require Docker.
- Commands: `make install`, `make dev`, `make db-migrate`, `make check` (Svelte/TypeScript, formatting, Rust fmt/Clippy), `make test` (model/history/autosave and SQLite/API integration), `make build`, and `make test-browser` (Playwright; first run `make browser-install`). Node.js 22.12+, pnpm 11, and stable Rust/Cargo with rustfmt and Clippy must be on PATH. Use `make format` for frontend and Rust formatting.
- Keep the tree/history model independent of Svelte and DOM. Do not pass Svelte proxies into history snapshots. Verify keyboard changes in a browser, including focus/selection and composition guards. Do not invent test results.
- Do not change global Codex settings or add secrets or user data to the repository.

- Development data lives in `data/forget-me-not.sqlite` by default (`FMN_DB_PATH` overrides it). Run integration and browser tests only against disposable databases; the browser runner creates its own temporary DB and ports. Never edit an applied migration; add a new SQL file. M2 identity is server-resolved and local-only, never a trusted client-supplied owner ID.

- Keep the module boundaries in `docs/code-structure.md`: tree commands have no UI/HTTP dependency; the editor pane does not fetch; Workspace coordinates sessions; HTTP handlers do not embed SQL; Store owns transaction boundaries. Prefer direct concrete modules over speculative generic layers.
