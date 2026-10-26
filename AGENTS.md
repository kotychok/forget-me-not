# Working agreements

- Use English for repository content, including documentation, comments, and code identifiers. Continue chatting with the user in Ukrainian unless requested otherwise.
- The user makes commits. Do not commit, amend, push, or publish without a separate explicit request. Do not initialize Git on your own.
- M1 implementation is authorized: a local, session-only editor. Keep backend persistence, import/export, authentication, and deployment in their later milestones unless the user requests them. M1 acceptance awaits user review.
- Distinguish agreed requirements, proposals, and open questions. Do not treat assumptions as approved decisions.
- Use `docs/architecture.md` for component boundaries, `docs/editor-behavior.md` for editor commands, `docs/data-formats.md` for formats, and `docs/database.md` for schema and migrations. Read only the documents relevant to the task.
- Record significant architecture decisions and changes to agreements in `docs/decisions.md`. Keep the current direction and questions in `docs/README.md`; use `docs/milestones.md` for roadmap status and acceptance criteria.
- Support native local execution without Docker and container deployment. Makefile is the common entry point for running, building, and checking; native execution must not require Docker.
- Commands: `make install`, `make dev`, `make check` (Svelte/TypeScript and formatting), `make test` (model/history), `make build`, and `make test-browser` (Playwright; first run `make browser-install`). Node.js 22.12+ and pnpm 11 must be on PATH. Use `make format` for frontend formatting.
- Keep the tree/history model independent of Svelte and DOM. Do not pass Svelte proxies into history snapshots. Verify keyboard changes in a browser, including focus/selection and composition guards. Do not invent test results.
- Do not change global Codex settings or add secrets or user data to the repository.
