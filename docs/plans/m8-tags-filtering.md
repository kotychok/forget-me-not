# M8 — Tags and filtering

Status: implemented and verified; awaiting user review. Authorized on 2026-10-28 after M7 acceptance.

## Initial scope

Exact case-sensitive tag names within owned list content; at most 12 tags/item and 40 Unicode characters/tag, with bounded current-list suggestions. A single-tag current-list filter projects matching items and ancestors, never rewriting content. Structural commands/collapse are locked while filtered; content metadata editing remains available. Clear/escape, undo/redo, and search transitions expose the complete relevant context safely. See [Tag behavior](../tags.md).

Pure validation/projection helpers live in `lib/tags.ts`, Editor owns one-command tag history, TagsDialog owns the temporary draft, EditorPane owns filter/navigation state, and Workspace retains content save/recovery responsibilities. No DOM/proxy object enters model history. Rust validates tags independently and stores compact JSON in the item row through existing owner-scoped row-diff transactions.

Add one SQL migration and JSON schema v3 with v1/v2 input compatibility, strict legacy fields, and empty-array normalization. Include tags in semantic comparison, recovery, import copies, and global search. Refuse Markdown export rather than lose metadata. No new dependency, catalog service, dynamic plugin, or full-text index is introduced.

## Verification plan

Pure name/count/Unicode/duplicate rules, tree projection/order/context, no tree mutation, one-command history/removal, old/current portable schemas, shared fixture, semantic conflict detection, and search context. SQLite save/import/copy/remove, tag ownership isolation, Markdown refusal, and upgrade from M7 preserving notes/content/view state. Browser Apply/Cancel/undo/reload, structural guards, navigation, focus-safe clearing, unfiltered export, global search out of a filter, JSON transfer and draft recovery. All data is synthetic/disposable.

## Verification evidence — 2026-10-28

- `make check` passed: Svelte/TypeScript, Prettier, Rust formatting, and Clippy with warnings denied.
- `make test` passed: 53 frontend and 33 Rust tests. New tests cover exact Unicode/case/count/length/duplicate rules, projection/order/context without tree mutation, one-command history, v1/v2/v3 boundaries, the shared v3 fixture, tag-aware acknowledgement comparison, search context, store persistence/copy/removal, account isolation, and an additive M7 upgrade preserving notes/content IDs/completion/revisions, view state, installation identity, and foreign-key integrity.
- All 46 isolated full-stack browser scenarios passed. New scenarios verify Apply/Cancel/undo/redo/reload, tag search activation, current-schema JSON download/reimport, explicit Markdown refusal, ancestor-preserving projection, structural toolbar/keyboard guards, arrow navigation, reset/focus, unchanged saved collapse state, full-tree export while filtered, search out of a filter, invalid drafts, and applied tag draft recovery.
- The filtered view was visually inspected at 390 pixels. Ancestor context, exact matches, active tag, structural lock, and reset action remain visible. Existing sticky-toolbar clearance and 5,000-item workflows passed.
- `make build` passed for frontend and backend. No dependencies or long-running development server were added. Tests used disposable databases/browser contexts; the user's development database was not opened or migrated by the agent.

Restart `make dev` before review to apply the additive migration and load the current API. New exports use schema v3; older v1/v2 inputs remain accepted under their field contracts. No commits were made.
