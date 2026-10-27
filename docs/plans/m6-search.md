# M6 — Cross-list search

Status: implemented and verified; awaiting user review. Authorized after user review and commit of M5 on 2026-10-27.

## Initial behavior

Search lists opens an accessible native modal. Search is a trimmed literal substring, case-insensitive with JavaScript Unicode regular-expression matching; regex metacharacters are escaped. It searches list titles and item text, including tasks, completed items, and collapsed descendants. Title-only hits support empty lists. No fuzzy matching, stemming, notes, tags, or remote content search.

Results show list title, ancestor context, and a bounded snippet around the first match, with escaped text highlighting. Show at most 200 results and the full match count; ask users to refine larger result sets. Arrow Down from the input enters results, arrows navigate results, Enter activates, and native Tab/Escape/modal focus rules remain available. Reopening retains the query and reloads data; Refresh search updates while open. Loading/failure states do not show partial results as complete.

Opening an item confirms list access/existence, checks its ID and current query match, opens the list, expands its ancestor path, centers it in the viewport, and focuses its navigation control. Missing/changed hits keep the dialog open with an error; title hits focus the list heading. Highlighting is a view-only marker, not stored content; edit mode shows the original text. History, pending saves, and cached local versions remain intact.

## Simple architecture and limits

Reuse the existing owner-scoped, read-only export snapshot endpoint rather than add a backend search/index subsystem. Workspace overlays cached editor documents, including unsaved/conflicting edits, on the server snapshot. This does not flush saves, instantiate editors for every list, change selection, or replace local documents. Access checks on activation use the existing owned GET endpoint. Cached documents remain the local version even if another tab has changed the server; M4 conflict rules still apply.

The export snapshot and merged search source use existing explicit limits: 100 lists, 10,000 items, 8 MiB, and normal per-list bounds. Exceeding these produces an error, not silently incomplete search. There is no database migration, new dependency, full-text index, or new request per keystroke. Each open/refresh reads a new snapshot; results are not live across tabs. Search requires a reachable backend. If measured scale outgrows these limits, design a dedicated paginated server search rather than increase snapshot limits blindly.

`lib/search.ts` is pure matching/context/snippet logic. Workspace owns read coordination, local overlay, and checked activation. SearchDialog owns modal state, result controls, and request-generation guards against stale close/reopen responses. MarkedText renders escaped highlight spans. App connects selection/URL and a reveal request to EditorPane; EditorPane expands, focuses, and scrolls without fetching.

## Verification plan

Literal/Unicode matches, ancestry/order, empty and title hits, snippets, explicit result caps, local edits without flushing, unchanged history, missing/changed results, and read failures. Browser tests cover cross-list/collapsed navigation, keyboard focus, retained query, local unsaved results/history, loading failures/retry, and stale hits. Existing owner-isolated export tests cover the reused server boundary. Tests use disposable databases only.

## Verification evidence — 2026-10-27

- 38 frontend tests passed, including pure literal/Unicode matching, context/order, result bounds, snippet preservation, local overlays without flushing, retained history, stale target checks, and activation of a list created after sidebar load.
- All 33 isolated full-stack browser scenarios passed. Search scenarios cover collapsed cross-list navigation, highlights, local unacknowledged changes and history, retained queries, title-only/empty-list navigation, no results, read failure/retry, and removed targets.
- Search scenarios were rechecked after adding a narrow viewport and activation/sidebar handling; desktop and 390-pixel screenshots were visually inspected. No horizontal dialog overflow was observed.
- `make check` passed with no Svelte/TypeScript diagnostics, Prettier issues, Rust formatting issues, or Clippy warnings. The production frontend build passed.
- Existing database/API code and schema were unchanged; tests used disposable databases and did not modify development data. No new long-running development server was started.

No commits were made. The user makes commits after review.
