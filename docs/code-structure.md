# Code structure and extension boundaries

The application uses small modules with direct calls. There is one frontend and one backend; no plugin framework, generic repository layer, dependency-injection container, or event bus is needed.

## Frontend

```text
App.svelte — composes the page, URL selection, rename input, and browser dialogs
  ├── Workspace — list/session lifecycle and API coordination
  │     ├── Editor — tree commands and session undo/redo
  │     ├── Autosave — one ordered save queue per list, revisions, retry reconciliation
  │     ├── Drafts — scope, serialized local writes, acknowledgement cleanup
  │     │     └── IndexedDbDrafts — native storage adapter
  │     └── api — HTTP/JSON transport
  ├── EditorPane.svelte — tree UI, keyboard/composition events, DOM focus and selection
  ├── KeyboardGuide.svelte — accessible modal guide
  ├── JsonTransfer.svelte — file selection, preview, downloads, and confirmation
  └── RecoveryPanel.svelte — draft preview and explicit recovery/conflict actions
```

- `lib/links.ts` detects plain-text HTTP/HTTPS links and formats compact display strings without mutating source data; it has no DOM, model, or HTTP dependency. `lib/auto-size.ts` is a DOM action for textarea content/width sizing and cleanup, with no tree/history dependency.
- `lib/editor.ts` knows only item data, commands, and history. It does not import Svelte, HTTP, or browser DOM APIs. ID generation uses platform crypto.
- `lib/autosave.ts` manages save generations and acknowledgements. It accepts explicit save/get functions and has no UI dependency. An acknowledgement never replaces current editor content.
- `lib/api.ts` owns URLs, request timeouts, JSON, and HTTP errors.
- `lib/workspace.ts` owns list metadata and cached editor sessions. It coordinates the concrete API and queues, exposes ordinary state, and notifies the UI through one callback. It knows nothing about Svelte, URL history, focus, or confirmation dialogs.
- `components/EditorPane.svelte` renders one session. It signals content edits through `ondirty`; it does not fetch or decide when to save. A keyed component instance follows a selected list; the cached Editor and collapse state survive list switching.
- `App.svelte` connects these modules and owns browser-level behavior such as URL selection, unload warnings, rename focus, and deletion confirmation. Raw session objects stay outside Svelte's deep proxies so model snapshots remain cloneable.

There is no second authoritative tree in the UI. The Editor owns content/history; the pane publishes a reactive display copy. Sidebar metadata is a projection of the corresponding session/API result, not another editable tree.

`lib/portable.ts` owns pure JSON validation and serialization; it does not read files, fetch, or write data. Workspace coordinates exports/imports through the concrete API; JsonTransfer handles browser file/download APIs.

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
              └── migrations/*.sql — versioned schema changes
```

`store.rs` is intentionally SQLite-specific: it is the one place to reason about SQL, row diffs, and atomic writes. Validation and storage do not use HTTP status codes; the HTTP adapter maps application failures into responses. `portable.rs` validates versioned transfer envelopes while reusing item validation. `lib.rs` exposes the modules and a small public entry surface for the executable and tests.

Do not add a separate service/repository abstraction until actual behavior needs it. Splitting a module should follow independent responsibilities or a concrete extension, not a target file length.

## Adding features

- New tree command: add it to Editor, test its invariants/history, then connect a pane action/shortcut. Do not place tree mutation rules in an HTTP handler or template.
- New portable item field: add a schema migration and backend model/validation/storage support, then frontend model, UI, and format-schema handling in M3. Existing applied migrations remain immutable.
- New import/export format in M3: add pure conversion functions around the document model. Reuse normal server validation and atomic writes instead of a parallel persistence path.
- Draft recovery is attached through the dedicated Drafts manager. Keep native IndexedDB calls out of Editor, Autosave, Workspace, and DOM focus logic. Changes to authentication identity require a fresh Workspace/cache before another account is displayed.
- Authentication in M11: replace server-resolved local identity at the HTTP boundary; preserve owner-scoped store operations. Never trust a client-supplied owner ID.

## Verification boundaries

Model, queue, and workspace tests run without Svelte or a browser. SQLite/API integration tests use disposable databases. Browser tests verify the complete composition, especially focus, switching sessions, autosave races, and persistence. Prefer testing behavior over module layout or private implementation details.
