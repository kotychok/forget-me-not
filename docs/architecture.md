# Architecture

## Components

Agreed stack: Svelte + TypeScript + Vite in the browser; Rust + Axum for the HTTP API; SQLite for storage. Select versions and dependencies before implementation using current documentation.

```text
Browser
  Svelte UI → editor commands → TypeScript tree model
                                  ↓
                      autosave queue + IndexedDB draft
                                  ↓ HTTP, same origin
Rust / Axum → validation → SQLite
  └── static frontend assets
```

The tree model and commands do not depend on Svelte, the DOM, HTTP, or the database. A command returns the new state and information needed to restore focus and undo. The UI renders visible nodes and routes keyboard input. The server validates invariants independently rather than trusting the browser.

Initially, one repository with future `frontend/`, `backend/`, and `docs/` directories is sufficient. Do not introduce microservices, CRDTs, or event sourcing without a need. Items display Markdown; editing uses a plain textarea. Revisit a larger rich-text editor based on actual use cases.

## Local development and commands

Docker is not a required dependency for local development. With the proposed stack, frontend and backend run natively; SQLite uses a local file in `data/`. During development, the frontend can proxy `/api` to the backend so the browser uses a single origin.

Proposed contract for the future Makefile:

| Command | Purpose |
| --- | --- |
| `make help` | Show available commands |
| `make dev` | Run frontend and backend without Docker; stop both processes on exit |
| `make build` | Build frontend and backend natively |
| `make run` | Run the built application without Docker |
| `make check` | Check formatting, lint, and types |
| `make test` | Run tests |
| `make docker-build` | Build the image |
| `make docker-up` / `make docker-down` | Start / stop the container environment while preserving data |

Target names are proposed; Makefile has not been implemented. Commands should invoke the stack's standard tools rather than duplicate their logic. Configure the database path, address, and port explicitly through environment variables; local and container data must not accidentally overwrite each other. Normal shutdown does not delete SQLite data or volumes.

## Persistence

Agreed: each user can have multiple lists. Agreed schema: `users → lists → items`, with one row per item, a same-list parent reference, and explicit sibling order. See [Database and migrations](database.md) for agreed UUIDv4 identifiers and SQLx migration management, plus draft SQL, ownership constraints, and transactions.

The agreed normalized storage approach replaces the earlier single-JSON-document storage proposal. JSON remains the nested API/export format; normalized rows are the canonical database representation. Whole-list snapshot saves with revision checks are the agreed initial approach, with a validated row diff and revision increment in one transaction. Transfer-size optimization is deferred to M10. Detailed SQL constraints remain a draft; no database has been implemented.

## Autosave and drafts

- Changes appear locally immediately. After a short pause, initially proposed as 500 ms, send a snapshot; tune the interval after the prototype.
- Allow one save request in flight per list. Accumulate subsequent changes; an older response must not mark a newer revision as saved.
- Each write includes its base `revision`; the server uses compare-and-swap. A mismatch returns `409 Conflict` without overwriting newer state.
- If a response is lost, reconcile server state/revision before retrying. Add a request identifier for idempotency if needed.
- Store a draft in IndexedDB with the list, base revision, and timestamp. Local storage failures must be visible. Scope drafts by server and owner.
- UI states: “Unsaved changes”, “Saving…”, “Saved”, “Error”, “Conflict”. “Saved” means the server has acknowledged the current snapshot.
- On reload, compare the draft with the server. Do not automatically apply different local text over a newer server version: offer to open the draft as a separate copy or download its JSON.
- On conflict, stop autosaving that list, preserve local changes, and allow loading the server version and saving the local version as a copy. No automatic merge in v1.

Drafts protect against failures; they do not provide full offline support. Do not rely on a request during page close; browser storage is not a backup.

## Outline API

| Request | Result |
| --- | --- |
| `GET /api/lists` | List metadata |
| `POST /api/lists` | Create a list |
| `GET /api/lists/:id` | Document and revision |
| `PUT /api/lists/:id` | Snapshot + baseRevision, atomic write |
| `DELETE /api/lists/:id` | Delete with a revision check |

Export and import preview can run in the browser; the server validates the result when saving. Define error contracts and limits before coding. Workspace import will need a separate atomic operation if included in v1.

## Access and deployment

Agreed: deploy with Docker; native local execution without Docker is also supported. Makefile is the common entry point for running, building, and checking in both modes. The specific server remains undecided.

Proposal: one container with the server and frontend assets; Docker Compose for startup and volume configuration; SQLite in a persistent volume; HTTPS through a reverse proxy. Do not place SQLite on a network filesystem without separate verification. Do not run multiple replicas with independent database files.

Each list belongs to a user, and each user can have multiple lists. The schema can support multiple accounts, but registration and the authentication mechanism remain undecided. A single-account deployment is still possible. Before public deployment, choose application authentication or a verified auth proxy/VPN. Trust identity headers only from a restricted proxy. Cookie authentication needs CSRF protection and secure cookies.

Markdown is untrusted text: disable or sanitize raw HTML, disallow unsafe URLs, and keep secrets and list content out of logs. Validate import and depth limits on the server as well.

Backups: use a consistent SQLite backup operation rather than copying only the main file while WAL is active. Define retention and regularly verify restoration. JSON export supplements backups but does not include access settings or all server state.
