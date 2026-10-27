# M6a — Format adapters and outline-Markdown transfer

Status: complete; the user verified export and accepted the current behavior on 2026-10-27. Authorized on 2026-10-27 after agreement on top-level paragraphs, indentation, and task markers.

## Implementation

Pure compiled Rust adapters live in `backend/src/transfer/`: a small `Format` enum dispatches decode/encode separately to `json.rs` and `markdown.rs`. Shared portable validation remains authoritative. No dynamic library loader, plugin runtime, new dependency, database schema change, or second persistence path was introduced.

`POST /api/transfer/decode` accepts `{format,text}` and returns `{document,warnings}` without writing. `POST /api/transfer/encode` accepts `{format,document}` and returns encoded text, extension, media type, and warnings without writing. Both retain the same local Host/Origin boundary. The decoder validates the actual UTF-8 text against 8 MiB; its transport envelope allows up to six times that size plus a small margin for JSON string escaping. Encoding and commit requests retain their respective file/save limits.

TransferDialog replaces the JSON-specific component. App supplies conversion functions; Workspace still owns snapshot export and atomic new-copy import. Browser checks file size and strict UTF-8; JSON retains its original client schema validation and the server converter validates again. Markdown conversion runs only on the server. A request generation guard prevents a late conversion from populating a closed/replaced preview. Closing preview performs no writes. Existing uncertain-import handling and index refresh remain.

Current JSON export keeps its local serialization/download path, so recovery/export does not depend on the conversion service. The Rust JSON encoder is also available through the shared conversion API. Markdown export sends the current snapshot, including unsaved/conflicting edits, for read-only conversion. It supports one current list at a time; all-list export remains JSON.

## Dialect and explicit limits

See [Data formats](../data-formats.md#outline-markdown-contract--m6a). Import one file as one list. The first level-one heading supplies the title (including optional closing hashes); otherwise use `Imported outline`. Additional headings are literal root items with warnings. Top-level paragraphs are separate roots, with consecutive paragraph lines joined by newlines. List nesting follows spaces; bare and list-marked checkbox syntax creates tasks. Three-space nesting from the reference file is supported. URLs are not fetched and raw HTML is not interpreted.

Export uses two-space nesting and escaped literal text; continuation lines use two extra spaces. Blank/space-only continuations preserve content. Explicit errors cover ambiguous indented prose after a separating blank, orphan indentation, structural tabs, fences, unsupported export whitespace/title shapes, invalid content, and size/depth limits. Number/bullet style and IDs are not preserved in Markdown; format notes explain this before import and before export. JSON remains the complete portable format.

The item limit is now 5,000 on both frontend and backend; 5,001 is rejected. The independent 1 MiB save, 8 MiB transfer, 10,000 batch-item, and depth/text/title limits remain unchanged. Large text can hit the byte limit before the item-count limit. No list is silently truncated or split.

## Verification — 2026-10-27

- `make check` passed: Svelte/TypeScript, Prettier, Rust formatting, and Clippy with warnings denied.
- `make test` passed: 39 frontend and 23 Rust tests. New tests cover the agreed six-root example, checkbox/nesting semantics, literal punctuation/checkbox-like text, multiline/empty/whitespace round-trips, explicit errors, conversion without writes, and 5,000/5,001 boundaries.
- All 35 browser scenarios passed before adding the local JSON fallback test; the final nine transfer scenarios also passed (36 distinct browser scenarios verified). These checks cover the renamed component, narrow preview layout, Markdown download/reimport, new-copy IDs, unchanged original lists, local JSON fallback, and the existing JSON workflows.
- A 5,000-item synthetic Markdown list passed preview/import, full render, indent, undo, edit, acknowledged save, search/reveal, JSON export, and reload. The measured combined load/edit/undo/save/search/reload portion was approximately 3.9 seconds on the local test machine; this is not a per-operation latency guarantee or a benchmark across hardware.
- The user's private reference file decoded and passed portable validation locally without database writes. After confirmation that the user retained a separate copy, it was deleted from the repository directory and its path ignored. No personal content is included in tests.
- The narrow Markdown preview was visually inspected. No horizontal overflow was observed.
- `make build` passed for frontend and backend. No long-running development server was started; only disposable test servers/databases were used.

No commits were made. Restart an already-running development backend to load the new routes and limits before trying import.
