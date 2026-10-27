# M7 — Item notes

Status: complete; implemented, verified, and accepted by the user on 2026-10-27. Authorized by the user on 2026-10-27 after M6b acceptance.

## Scope and defaults

One plain-text note per item/task, 64 KiB UTF-8. Modal Apply/Cancel with a one-command history commit, indicator, toolbar action, and navigation-mode N shortcut. Markdown/HTML are literal, with rendering deferred to M9. Notes participate in content revisions, row-diff persistence, draft recovery, semantic acknowledgement comparison, search and JSON v2. Existing v1 files remain readable with empty notes. Markdown export refuses a list containing notes rather than dropping them.

Use the existing ownership, save, conflict, import-copy and recovery paths. Add one SQL migration, a pure Editor setNote command, and a focused NoteDialog component. No separate notes service, persistence queue, database, UI framework, or dependency is needed. See [Note behavior](../notes.md).

## Verification plan

- Model undo/redo, branch movement, note removal, no-op history; portable v1/v2 compatibility, bounded Unicode strings and the shared v2 fixture.
- Semantic comparison distinguishes notes after a lost save reply; no newer note is incorrectly acknowledged or pruned.
- SQLite persistence/copy/export/update and an additive M6b upgrade preserving content/IDs, view preferences/revision, and installation identity.
- Browser Apply/Cancel/reopen focus, undo/redo, literal source, reload, note search activation, v2 download/reimport, Markdown refusal, applied-draft recovery, and size boundaries. Keep all tests synthetic and disposable.

## Verification evidence — 2026-10-27

- `make check` passed: Svelte/TypeScript, Prettier, Rust formatting, and Clippy with warnings denied.
- `make test` passed: 47 frontend tests and 29 Rust tests. New coverage verifies single-step note history, branch movement/removal, v1/v2 schema boundaries, shared v2 fixture, note-aware semantic reconciliation, search context, persistence/copy/export, 64 KiB limits, and an additive M6b upgrade preserving content/IDs, completion, saved view preferences/revision, installation identity, and foreign-key integrity.
- All 43 isolated full-stack browser scenarios passed, including note Apply/Cancel/reopen, undo/redo, literal multiline source, focus return, reload, note-result activation, JSON v2 download/reimport, explicit Markdown refusal, applied draft recovery, and 65,536/65,537-byte UI boundaries.
- Fixed a queued native close-event race: note modal controls now synchronously complete cancellation/application, including Escape, so an earlier close cannot clear the next opened note.
- The note dialog was visually inspected at 390 pixels; no horizontal overflow was observed. Source HTML/Markdown characters display literally.
- `make build` passed for frontend and backend. No new dependency or long-running development server was added; tests used disposable data only. The user's development database was not opened or migrated by the agent.

Restart `make dev` to apply the additive migration and load the current API before review. Old v1 files remain importable; new JSON files use v2 and require a reader that supports v2. No commits were made.
