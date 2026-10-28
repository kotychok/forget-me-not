# M10 — Task dates

Authorized after the user reported M9 committed. M9 is accepted. The user selected only a date-only deadline. Implementation defaults await user review.

Implemented:

1. Define date-only validation and local-calendar status without UTC conversion.
2. Add optional content fields through an additive SQLite migration, owned snapshots and row diffs.
3. Add one undoable modal Apply/Cancel command; keep its unapplied draft separate.
4. Introduce JSON v4, read v1–v3, and reject date fields in older versions. Update draft validation and semantic equality; refuse lossy outline-Markdown export.
5. Verify calendar boundaries, history, concurrent saves, recovery, portable round-trip, migration upgrade and browser focus/status behaviour using disposable data.

No reminders, recurrence, calendar view or external integrations are included.


Verification:

- `make test`: 61 frontend tests and 36 Rust integration tests pass. New coverage includes Gregorian boundaries, leap centuries, date history/conversion, semantic reconciliation, v4/legacy validation, shared synthetic v4 fixture, date persistence/update/clear/copy, stale-revision rejection and additive upgrade preserving content/view state.
- `make check` and `make build` pass (TypeScript/Svelte, formatting, Rust fmt/Clippy, frontend/backend build).
- All 49 browser scenarios pass in the final full regression run. New scenarios cover Apply/Cancel, clearing/undo, local-day rollover, completion status, reload/JSON/search, applied-date draft recovery and unchanged dates in Pacific/Kiritimati and Pacific/Honolulu.
- Mobile date dialog inspected at 390px. Native calendar presentation follows the browser locale; model values remain ISO calendar strings.
- Stabilized an existing back-to-top test by waiting for all seeded items before scrolling; it previously scrolled during asynchronous list loading. No scroll behavior change was needed.

Restart the backend to apply the embedded migration. Test databases were disposable; the user's development database was not edited. No commits were created.
