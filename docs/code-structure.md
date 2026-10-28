# Code structure and extension boundaries

The application uses small modules with direct calls. There is one frontend and one backend; no plugin framework, generic repository layer, dependency-injection container, or event bus is needed.

## Frontend

```text
App.svelte — authentication gate and account controls
  └── WorkspaceApp.svelte — page, URL selection, rename input and editor dialogs
  ├── Workspace — list/session lifecycle and API coordination
  │     ├── Editor — tree commands and session undo/redo
  │     ├── OutlineState — manual view preferences, independent revision/queue/retry
  │     ├── Autosave — one ordered save queue per list, revisions, retry reconciliation
  │     ├── Drafts — scope, serialized local writes, acknowledgement cleanup
  │     │     └── IndexedDbDrafts — native storage adapter
  │     └── api — HTTP/JSON transport
  ├── EditorPane.svelte — tree UI, keyboard/composition events, DOM focus and selection
  ├── SearchDialog.svelte — read-only search snapshot, results, and activation UI
  ├── TagsDialog.svelte — temporary tag draft, validation and suggestions
  ├── NoteDialog.svelte — temporary plain-text note draft, Apply/Cancel and size/focus handling
  ├── MarkedText.svelte — escaped literal match highlighting
  ├── KeyboardGuide.svelte — accessible modal guide
  ├── TransferDialog.svelte — file selection, preview, downloads, and confirmation
  └── RecoveryPanel.svelte — draft preview and explicit recovery/conflict actions
```

- `lib/links.ts` detects plain-text HTTP/HTTPS links and formats compact display strings without mutating source data; it has no DOM, model, or HTTP dependency. `lib/auto-size.ts` is a DOM action for textarea content/width sizing and cleanup, with no tree/history dependency.
- `lib/search.ts` owns pure literal matching, result context, snippets, and result caps. Workspace overlays cached local documents on a read-only owned snapshot and validates activation; SearchDialog owns modal state and stale-response guards. App sends a view-only reveal request to EditorPane for expansion, focus, and scroll. Search never flushes autosave or adds history.
- `lib/tags.ts` owns pure tag validation, name discovery and ancestor-preserving tree projection. Editor commits tags in one history step; EditorPane owns the local filter and structural guards. Filtering never becomes the authoritative tree, file content, or saved view preference.
- `lib/editor.ts` knows only item data, commands, and history. It does not import Svelte, HTTP, or browser DOM APIs. ID generation uses platform crypto. setNote is one history command; notes stay with branches.
- `lib/outline-state.ts` manages manual collapse preferences and per-ID replay after view revision conflicts. Workspace owns it per session and supplies preference snapshots/callbacks to EditorPane. Temporary reveal and focus safety stay in the pane; view preferences never enter Editor history or file formats.
- `lib/autosave.ts` manages save generations and acknowledgements. It accepts explicit save/get functions and has no UI dependency. An acknowledgement never replaces current editor content.
- `lib/api.ts` owns URLs, request timeouts, JSON, and HTTP errors.
- `lib/workspace.ts` owns list metadata and cached editor sessions. It coordinates the concrete API and queues, exposes ordinary state, and notifies the UI through one callback. It knows nothing about Svelte, URL history, focus, or confirmation dialogs.
- `components/EditorPane.svelte` renders one session. It signals content edits through `ondirty`; it does not fetch or decide when to save. A keyed component instance follows a selected list; the cached Editor and collapse state survive list switching.
- `WorkspaceApp.svelte` connects these modules and owns browser-level behavior such as URL selection, unload warnings, rename focus, and deletion confirmation. Raw session objects stay outside Svelte's deep proxies so model snapshots remain cloneable.

There is no second authoritative tree in the UI. The Editor owns content/history; the pane publishes a reactive display copy. Sidebar metadata is a projection of the corresponding session/API result, not another editable tree.

`lib/portable.ts` owns pure JSON validation and serialization; it does not read files, fetch, or write data. Workspace coordinates exports/imports through the concrete API; TransferDialog handles browser file/download APIs.

`lib/documents.ts` compares document content independently of field insertion order. `lib/download.ts` is the shared browser JSON-download adapter. Recovery actions pause Autosave before replacing a session; `{#key current}` remounts the pane when a fresh server version replaces the editor.

## Backend

```text
main.rs — configuration, migration startup, loopback listener, shutdown
  └── http.rs — routes, request extraction, local access checks, status mapping
        ├── model.rs — data and request/response shapes
        └── store.rs — owner-scoped SQLite operations and transaction boundaries
              ├── validation.rs — IDs, limits, flattening and content invariants
              ├── error.rs — application failure categories
              ├── store/transfer.rs — consistent exports and atomic new-copy imports
              ├── store/view_state.rs — owned view metadata and independent CAS transactions
              └── migrations/*.sql — versioned schema changes
```

`store.rs` is intentionally SQLite-specific: it is the one place to reason about SQL, row diffs, and atomic writes. Validation and storage do not use HTTP status codes; the HTTP adapter maps application failures into responses. `transfer/` contains pure format adapters with separate decode/encode dispatch; the HTTP layer exposes read-only conversion endpoints and never parses Markdown itself. `portable.rs` validates versioned transfer envelopes while reusing item validation. `lib.rs` exposes the modules and a small public entry surface for the executable and tests.

Do not add a separate service/repository abstraction until actual behavior needs it. Splitting a module should follow independent responsibilities or a concrete extension, not a target file length.

## Adding features

- New tree command: add it to Editor, test its invariants/history, then connect a pane action/shortcut. Do not place tree mutation rules in an HTTP handler or template.
- New portable item field: add a schema migration and backend model/validation/storage support, then frontend model, UI, and format-schema handling in M3. Existing applied migrations remain immutable.
- New import/export format in M3: add pure conversion functions around the document model. Reuse normal server validation and atomic writes instead of a parallel persistence path.
- Draft recovery is attached through the dedicated Drafts manager. Keep native IndexedDB calls out of Editor, Autosave, Workspace, and DOM focus logic. Changes to authentication identity require a fresh Workspace/cache before another account is displayed.
- Authentication in M11: replace the globally fixed local identity with an authenticated principal and owner-scoped Store per request at the HTTP boundary; preserve owner-scoped store operations. Never trust a client-supplied owner ID.

## Verification boundaries

Model, queue, and workspace tests run without Svelte or a browser. SQLite/API integration tests use disposable databases. Browser tests verify the complete composition, especially focus, switching sessions, autosave races, and persistence. Prefer testing behavior over module layout or private implementation details.

## Format adapters — M6a

Small, statically compiled Rust modules live under `transfer/`: `mod.rs` for supported formats/capabilities, `json.rs`, and `markdown.rs`. Import and export are separate capabilities; a future format may implement just one. This is a source-module extension point, not dynamically loaded shared libraries or an external plugin runtime.

Adapters only decode/encode; they do not authenticate, access SQLite, mutate sessions, or assign persisted ownership. Decode produces the shared portable model plus warnings, followed by existing limits/validation. Formats without IDs need temporary normalization IDs before validation; the common atomic import still assigns fresh persisted IDs. JSON's strict ID/schema contract is preserved. Export consumes a shared document snapshot and produces bytes, media type, suggested extension, and any loss warnings.

Implemented flow: read-only decode/preview → explicit confirmation → existing atomic new-copy import; current-local or saved-workspace snapshot → selected encoder → download. Keep current-list exports inclusive of unsaved edits, all-list export consistency, and uncertain-import response handling. Avoid duplicate format parsers on the frontend; use read-only backend conversion endpoints while keeping the UI responsible for selection, warnings, preview, and confirmation. The `Format` enum dispatches decode and encode separately. Each adapter is a pure module; a future unsupported direction can return an explicit error without creating a dynamic plugin loader. App passes conversion API functions into TransferDialog; Workspace continues to own persistence and export snapshot coordination.

## Markdown display — M9

`lib/markdown.ts` converts Marked lexer tokens into a bounded allowlisted model, sharing `safeHttpUrl` with plain links. `MarkdownView.svelte` renders known elements through Svelte escaping; it never injects generated HTML. EditorPane owns the view-only preview toggle and separate link controls; NoteDialog can preview its unapplied draft. The tree, history, API, database and portable formats retain original source.

## Due dates — M10

`lib/dates.ts` owns pure calendar validation, local-date formatting and status comparison without timestamps. Editor.setDueDate commits one content-history change. DateDialog holds only the modal draft; EditorPane owns the Date/D action, badge and view-only clock refresh. Portable validation and backend flatten validation independently enforce the date contract; Store includes the nullable column in owned row diffs and new-copy import. No date framework or external service is required.

## Authentication — M11

`auth/mod.rs` owns principal/account types, credential validation, bounded blocking password hashing and axum-login backend integration; `auth/store.rs` owns SQL/transactions and library-store cleanup; `auth/routes.rs` owns extraction/status/route protection. HTTP middleware supplies a fresh owner-scoped Store as a request extension. Local-only test construction remains explicit and refuses accounts at request time. `App.svelte` gates/mounts the editor shell, `lib/auth.ts` provides credential/session transport, and `AccountDialog` owns transient account controls. Workspace pause/logout/reconcile methods stay free of DOM/cookie/Svelte dependencies. API transport carries an expected owner to prevent account-switch replay.
