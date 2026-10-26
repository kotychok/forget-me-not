# M3 — JSON portability

Status: implemented and verified; awaiting user review. Authorized by the user's request to proceed with M3 and limit file transfer to JSON.

## Scope

Versioned JSON, current-list export, all-saved-lists export, strict file validation, preview, and atomic import as new copies. Markdown file import/export is removed from scope. Markdown rendering in item text is deferred to M11; current text, including Markdown-looking characters, is preserved literally.

## Defaults and boundaries

- Schema v1 contains only `schemaVersion` and `lists`; each list contains ID, title, and nested nodes. No owners, revisions, credentials, collapse state, or undo history.
- Import assigns fresh UUIDv4 IDs to every list/item, preserving order, text, nesting, kind, and completion. No merge, overwrite, or ID-preserving restore mode.
- Preview is local and performs no writes. Confirmation sends one batch; Store validates it again and writes all copies in one transaction.
- Current-list export includes current local edits, including conflicted/unsaved text. All-list export flushes pending queues and obtains one consistent, owner-scoped server snapshot.
- Transfer limits: UTF-8 JSON up to 8 MiB, 1–100 lists, 10,000 total items; existing per-list limits and the 1 MiB save limit still apply.
- No database schema changes are needed: portability uses the existing normalized tables. Applied migration files remain untouched.
- Import is not automatically retried after a lost response; the UI reports uncertainty and asks users to check their lists before choosing the file again.

## Module plan

Pure frontend portable validator/serializer; backend portable validation; Store transfer submodule for transactional reads/inserts; existing HTTP adapter exposes transfer routes; Workspace coordinates queues and list metadata; JsonTransfer owns file selection, download, preview, and modal interaction.

## Verification

Shared fixture for both languages; format round-trip and malformed/oversized documents; rollback from a simulated failure in the second imported list; owner-scoped exports; browser downloads and preview confirmation; all-list flushing and local conflict export. Run full regression checks/build and update milestone evidence.

## Verification evidence — 2026-10-26

- `make check`: Svelte/TypeScript and Prettier passed without diagnostics; Rust fmt and Clippy passed with warnings denied.
- `make test`: 20 frontend model/autosave/workspace/format tests and 16 SQLite/API integration tests passed.
- `make build`: production frontend and Rust backend built successfully.
- `make test-browser`: all 20 isolated full-stack Chromium scenarios passed. New cases cover current/all downloads, preview/no-write cancellation, new-copy import, local conflict export, and a deliberately lost import response with index refresh preserving local edits.
- A simulated database trigger failure on the second list rolled back every imported list/item while preserving existing data.
- Valid multi-list import larger than the normal 1 MiB save limit succeeded through the explicitly limited 8 MiB import route.
- No applied migration file was changed; M3 needs no schema change. Existing development data is retained.

The runtime and verification approach remain the same as M2. Browser tests use disposable databases, not the development file. Local JSON selection/preview is read-only until confirmation; no sample data is imported into the user's database for visual inspection.

## Limitations

No overwrite, merge, ID-preserving restore, Markdown document transfer, or new Markdown rendering. JSON excludes server/account/session metadata. Import intentionally creates another copy if explicitly repeated; it is not automatically retried after an uncertain response. Refreshing the list index is read-only and preserves cached editor sessions. Authentication and durable draft recovery remain M5/M4.

The import/export modal and a two-list preview were visually inspected at 970 × 954 without confirming an import. The running development server was restarted for M3 without schema changes. `git diff --check` and local documentation link checks passed. No commits were made.
