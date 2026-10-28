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

Use one repository: `frontend/` contains the editor, `backend/` implements M2 persistence, and `docs/` contains design records. Do not introduce microservices, CRDTs, or event sourcing without a need. Items retain literal text, with compact plain-text URL display and separate safe HTTP/HTTPS opening controls. Editing uses a content-sized plain textarea. Markdown rendering inside item text is deferred to M9; outline-Markdown file transfer is implemented in M6a through shared-model Rust adapters. Revisit a larger rich-text editor based on actual use cases.

## Local development and commands

Docker is not a required dependency for local development. With the proposed stack, frontend and backend run natively; SQLite uses a local file in `data/`. During development, Vite proxies `/api` to the backend so the browser uses a single origin. The root `scripts/dev.mjs` manages both processes, waits for backend readiness, and shuts down their process groups on exit.

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

The root Makefile implements `install`, `dev`, `build`, `run`, `db-migrate`, `check`, `format`, `test`, `browser-install`, and `test-browser` for the frontend and backend. Docker targets remain planned. `make run` serves built assets and the API together; `make dev` starts both development processes. Commands should invoke the stack's standard tools rather than duplicate their logic. Configure the database path, address, and port explicitly through environment variables; local and container data must not accidentally overwrite each other. Normal shutdown does not delete SQLite data or volumes.

## Persistence

Agreed: each user can have multiple lists. Agreed schema: `users → lists → items`, with one row per item, a same-list parent reference, and explicit sibling order. See [Database and migrations](database.md) for agreed UUIDv4 identifiers and SQLx migration management, plus draft SQL, ownership constraints, and transactions.

The agreed normalized storage approach replaces the earlier single-JSON-document storage proposal. JSON remains the nested API/export format; normalized rows are the canonical database representation. Whole-list snapshot saves with revision checks are the agreed initial approach, with a validated row diff and revision increment in one transaction. Transfer-size optimization is deferred to M14. The initial migration and owner-scoped SQLite implementation are in `backend/`. See the root README for implemented limits and runtime configuration.

## Autosave and drafts

M2 implements queued saves, revision checks, status indicators, and network-error retry/reconciliation. M4 adds scoped IndexedDB drafts, conditional cleanup, and explicit recovery/conflict actions; see [recovery behavior](recovery.md). Full offline startup and automatic merging remain excluded.

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
| `GET /api/lists/:id/view` | Owned manual collapse preferences and independent revision |
| `PATCH /api/lists/:id/view` | Revision-checked per-item view changes, separate from content |
| `GET /api/session` | Installation and server-resolved owner identity for local draft scope |
| `GET /api/export` | Consistent JSON export of owned saved lists; optional listId filter |
| `POST /api/transfer/decode` | Read-only format decoding and preview model with warnings |
| `POST /api/transfer/encode` | Read-only encoding of a validated snapshot |
| `POST /api/import` | Validate a schema-v1/v2/v3/v4 envelope (normalize to v4); create new copies atomically |

Export and import preview can run in the browser; the server validates the result when saving. Implemented validation/storage errors use an `error` message; conflicts return 409, missing or non-owned lists return 404, invalid documents return 422, and oversized bodies return 413. Axum extraction errors can be plain text; the client handles both response forms. M3 implements a separate atomic workspace-import operation with an 8 MiB route limit; normal save routes retain the 1 MiB limit.

## Access and deployment

Agreed: deploy with Docker; native local execution without Docker is also supported. Makefile is the common entry point for running, building, and checking in both modes. The specific server remains undecided.

Proposal: one container with the server and frontend assets; Docker Compose for startup and volume configuration; SQLite in a persistent volume; HTTPS through a reverse proxy. Do not place SQLite on a network filesystem without separate verification. Do not run multiple replicas with independent database files.

Each list belongs to a user, and each user can have multiple lists. The schema can support multiple accounts. M2 uses one server-resolved local user without login, restricted to local operation. Production authentication is assigned to M11; registration and the exact mechanism remain undecided. Before public deployment, choose application authentication or a verified auth proxy/VPN. Trust identity headers only from a restricted proxy. Cookie authentication needs CSRF protection and secure cookies.

Markdown is untrusted text: disable or sanitize raw HTML, disallow unsafe URLs, and keep secrets and list content out of logs. Validate import and depth limits on the server as well.

Backups: use a consistent SQLite backup operation rather than copying only the main file while WAL is active. Define retention and regularly verify restoration. JSON export supplements backups but does not include access settings or all server state.

## Code organization

The implemented module map and extension rules are documented in [Code structure](code-structure.md). Keep direct concrete boundaries: UI → Workspace/Editor/Autosave/API on the client, HTTP → Store/validation on the server.
