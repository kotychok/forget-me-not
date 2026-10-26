# Milestones

Updated: 2026-10-26. The core direction and later feature milestones are agreed; detailed acceptance criteria remain a working plan. M1 is implemented for local review; later implementation milestones have not started. No dates or effort estimates are committed. Agreed requirements are recorded in [Decisions](decisions.md); a milestone does not approve its underlying proposals.

Use this file for outcomes, dependencies, and progress. Use `docs/plans/` only for a detailed plan of a complex milestone when implementation begins. Mark a milestone complete only with actual verification evidence.

## Overview

| Milestone | Outcome | Depends on | Status |
| --- | --- | --- | --- |
| M0 | Agree the initial scope and technical direction | — | Complete (decisions documented) |
| M1 | Run a keyboard editor prototype locally | M0 | Implemented; awaiting user review |
| M2 | Persist user-owned lists with reliable autosave | M1 | Not started |
| M3 | Import and export JSON and Markdown | M2 | Not started |
| M4 | Restore drafts and handle concurrent edits | M2 | Not started |
| M5 | Deploy and recover a protected installation | M3, M4 | Not started |
| M6 | Item notes | M5 | Deferred |
| M7 | Tags and filtering | M5 | Deferred |
| M8 | Search across a user's lists | M5 | Deferred |
| M9 | Task dates | M5 | Deferred |
| M10 | Reduce data transfer and optimize the save protocol | M5 | Deferred |

M3 and M4 have no dependency on each other; the table does not require parallel implementation. Import/export fixtures can be designed before M2, but complete import persistence depends on it.

## M0 — Scope and technical direction

Outcome: enough agreement to implement the first useful prototype without fixing every future detail.

Completed through the user's explicit agreements:

- Svelte/TypeScript/Vite + Rust/Axum + SQLite.
- Notes, tags, search, and dates deferred to later milestones.
- Navigation/edit modes and plain-item/task conversion; Enter/Shift+Enter already agreed.
- Normalized users/lists/items, UUIDv4 identifiers, and mandatory SQLx migrations.
- Whole-list snapshots with revision checks as the initial save approach; reduced transfer is deferred.

Evidence: user confirmations recorded as D005, D006, D018–D024 in [Decisions](decisions.md). This completes the documentation milestone, not application implementation. Remaining behavior and operational details are assigned to M1–M5. The user has since authorized M1 implementation; later milestones remain outside the current implementation scope.

## M1 — Local keyboard editor

Scope: frontend tree model, command handling, visible-node navigation, editing, nesting, branch movement/deletion, collapsing, plain items/tasks, and session undo/redo. Add the local frontend Makefile entry point; extend it to start both processes when M2 adds the backend. Docker is not required.

Acceptance:

- The local prototype runs through a documented Makefile command.
- Enter creates a sibling after the current branch; Shift+Enter inserts a line break.
- Structural edits preserve descendant IDs and restore tree, focus, and cursor on undo/redo.
- Keyboard commands do not interrupt ordinary text editing or IME composition.
- Task conversion and completion follow the agreed rules.
- Empty lists and keyboard focus always provide a way to continue editing.

Verification: tree-command checks and browser interaction scenarios from [Editor behavior](editor-behavior.md); evidence is recorded in [M1 implementation](plans/m1-local-editor.md). User review of the editing feel is still pending. No persistence or draft recovery is provided at this milestone.

## M2 — Database, ownership, and autosave

Scope: backend API, users/lists/items, migrations, list management, ownership authorization, revision-checked saves, and save indicators. Extend `make dev` to manage frontend and backend processes. Add native migration and verification targets.

Decide first: account provisioning and identity source for this phase; expected list size and initial limits. Any temporary development identity must be limited to a clearly marked local-only mode; it is not production authentication.

Acceptance:

- A user can create, rename, reopen, and delete multiple lists using the agreed deletion behavior. Rename is initiated directly from the list heading; update the sidebar and breadcrumb consistently, and save through the revision-checked API.
- The database can be created from migrations and preserves data across server restarts.
- API access cannot read or mutate another user's lists, including through submitted item IDs.
- Indent/outdent commits the row diff, sibling ordering, and revision atomically without copying descendants.
- Conflicting revisions return a conflict without silently overwriting data.
- Slow/out-of-order responses cannot falsely mark newer local changes saved.
- The server handles transaction and commit failures with rollback.

Verification: disposable SQLite integration checks for ownership, constraints, revision conflicts, and migration application; browser reload and slow-save scenarios. Full draft recovery and conflict-resolution UI belong to M4.

## M3 — Portable data

Scope: versioned JSON, the agreed Markdown subset, import preview, new-copy import, and atomic persistence. Explicit restore preserving IDs is included only if separately selected.

Decide first: Markdown multiline/unsupported-block rules, file/node/depth limits, and whether exporting multiple lists needs an archive in v1.

Acceptance:

- JSON preserves every supported portable field and item ID on export/read.
- Markdown preserves the supported content subset; losses and unsupported constructs are explicit.
- Import never silently overwrites existing lists or reassigns ownership.
- Invalid imports do not leave partial records.
- The format schema version is independent of database migration versions and list revisions.

Verification: shared fixtures and round-trip checks, malformed input and ID collisions, and atomic import failure scenarios from [Data formats](data-formats.md).

## M4 — Draft recovery and conflicts

Scope: IndexedDB drafts, restore preview/copy, conflict UI, and safe retry/reconciliation. Full offline editing and automatic merging remain outside the proposed scope.

Acceptance:

- Reload after an unacknowledged edit offers recovery without replacing newer server content.
- Editing the same list in two tabs preserves both versions on conflict.
- A lost response does not cause an unsafe duplicate write or a false saved state.
- IndexedDB/quota errors are visible, and users can export their local version.
- Drafts are scoped by server and owner and are not exposed to another signed-in user.

Verification: interrupted requests, reload, two-tab edits, and local-storage failures using disposable data.

## M5 — Deployment and recovery

Scope: Docker image, proposed Compose setup if selected, Makefile deployment commands, chosen access protection, persistent storage, migrations, backups, and operating instructions.

Decide first: deployment environment, production identity/authentication, HTTPS entry point, backup location/retention, and supported upgrade policy.

Acceptance:

- Both native local startup and Docker deployment follow documented commands.
- Restarting or replacing a container preserves data; ordinary shutdown never deletes volumes.
- Access protection and owner isolation work with the selected production identity mechanism.
- Fresh installation and upgrade from the previous supported schema are verified.
- Migration failure prevents serving an uncertain schema; backups can be restored with compatible code.
- List Markdown is rendered safely and deployed limits match API validation.

Verification: disposable container smoke checks, authentication/authorization checks, upgrade and restore exercises, and documentation review. Publishing or modifying a real host is outside this documentation task and requires a concrete deployment request.

## Later milestones — agreed deferrals

These milestones are outside the initial core release. Their dependency on M5 keeps the current release focused; their relative order can change. Specific UI, field semantics, and implementation plans require design before work begins.

### M6 — Item notes

Outcome: separate notes attached to an item. Define Markdown support and editing behavior first. Acceptance: notes survive save/reload, migrations, and JSON round-trip; Markdown export/import explicitly preserves them or reports the limitation. Existing lists remain compatible.

### M7 — Tags and filtering

Outcome: attach tags and filter items without rewriting the tree. Define per-user tag identity and filtered-tree navigation first. Acceptance: users' tags are isolated; filtering preserves context and never changes stored order; formats and migrations cover the new metadata.

### M8 — Search

Outcome: search across the current user's lists and navigate to a result. Define searched fields and expected scale first. Acceptance: results respect ownership, reflect edits, and reveal the matching item within its ancestors without changing content. Choose indexing based on measured needs.

### M9 — Task dates

Outcome: task date metadata. Decide due-date versus scheduled-date semantics, date-only versus timestamp values, and timezone behavior first. Acceptance: dates survive migrations and JSON round-trip without timezone shifts; Markdown limitations are explicit. Reminders and recurrence are not implicitly included.

### M10 — Transfer-size optimization

Outcome: reduce the data exchanged for edits after the reliable snapshot implementation exists. Measure payload sizes and latency for agreed list sizes first. Compare compression, coalescing, conditional reads, patches, or operation-based writes; no specific replacement protocol is agreed yet.

Acceptance: representative indent/outdent and text edits exchange measurably fewer bytes against the recorded baseline; revision checks, retry/idempotency, draft recovery, and atomic writes remain correct. Document before/after measurements and protocol compatibility. Optimization must not turn partial failures into lost edits. Establish a quantitative target from the baseline before implementation.

## Remaining product details

Resolve within the relevant milestone rather than blocking all work now:

- M1: empty-item Enter behavior, task completion propagation, completion visibility, and deletion focus.
- M2: list deletion recovery, concurrent list ordering, and expected scale.
- M3: explicit restore mode, archive export, and precise Markdown normalization.
- M5: mobile support expectations and the release support matrix if required.

Keep recommendations marked as proposals until the user agrees; do not infer acceptance merely because a milestone mentions them.
