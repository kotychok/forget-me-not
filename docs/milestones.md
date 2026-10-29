# Milestones

Updated: 2026-10-29. The core direction and later feature milestones are agreed; detailed acceptance criteria remain a working plan. M1 was reviewed and committed by the user. M2 is implemented and verified; M3 JSON transfer was reviewed and committed by the user. M4 recovery was verified and accepted by the user; M5 links and long-text editing was reviewed and committed by the user; M6 search was reviewed and accepted by the user; M6a format adapters and review fixes were committed and verified by the user; M6b was verified and accepted by the user; M7 notes were verified and accepted by the user; M8 tags/filtering were reviewed and committed by the user; M9 Markdown display was committed by the user; M10 dates are implemented for review; M11 authentication and M11a account administration are implemented for local review; deployment remains deferred; the roadmap was reordered after M4 review because hosting is undecided. No dates or effort estimates are committed. Agreed requirements are recorded in [Decisions](decisions.md); a milestone does not approve its underlying proposals.

Use this file for outcomes, dependencies, and progress. Use `docs/plans/` only for a detailed plan of a complex milestone when implementation begins. Mark a milestone complete only with actual verification evidence.

## Overview

| Milestone | Outcome | Depends on | Status |
| --- | --- | --- | --- |
| M0 | Agree the initial scope and technical direction | — | Complete (decisions documented) |
| M1 | Run a keyboard editor prototype locally | M0 | Complete (reviewed and committed by user) |
| M2 | Persist user-owned lists with reliable autosave | M1 | Complete (user proceeded to M3) |
| M3 | Import and export JSON | M2 | Complete (reviewed and committed by user) |
| M4 | Restore drafts and handle concurrent edits | M2 | Complete (reviewed and accepted by user) |
| M5 | Open links and improve long-text editing | M4 | Complete (reviewed and committed by user) |
| M6 | Search across a user's lists | M4 | Complete (reviewed and accepted by user) |
| M6a | Format adapters and outline-Markdown transfer | M3, M6 | Complete (accepted by user; export verified) |
| M6b | Remember collapsed and expanded branches | M4 | Complete (verified and accepted by user) |
| M7 | Item notes | M4 | Complete (verified and accepted by user) |
| M8 | Tags and filtering | M4 | Complete (reviewed and committed by user) |
| M9 | Render Markdown inside item text | M5 | Complete (committed by user) |
| M10 | Task dates | M4 | Implemented and verified; awaiting user review |
| M11 | Accounts, login and browser sessions | M4; access design | Implemented and verified; awaiting user review |
| M11a | Admin-managed friends and account activation | M11 | Implemented and verified; awaiting user review |
| M11b | Scoped personal API tokens | M11; integration requirements | Planned; independent of deployment |
| M11c | Deploy and recover a protected installation | M11, M11a; hosting decision | Deferred: hosting undecided |
| M12 | Capture items through Telegram Inbox | M11c | Deferred |
| M13 | Optional, budget-controlled AI commands | M4; external API configuration | Deferred |
| M14 | Reduce data transfer and optimize the save protocol | M4; measured baseline | Deferred |
| M15 | Active and archived lists | M6; portability/schema design | Deferred |

M3 and M4 have no dependency on each other; the table does not require parallel implementation. Import/export fixtures can be designed before M2, but complete import persistence depends on it.

## M0 — Scope and technical direction

Outcome: enough agreement to implement the first useful prototype without fixing every future detail.

Completed through the user's explicit agreements:

- Svelte/TypeScript/Vite + Rust/Axum + SQLite.
- Notes, tags, search, and dates deferred to later milestones.
- Navigation/edit modes and plain-item/task conversion; Enter/Shift+Enter already agreed.
- Normalized users/lists/items, UUIDv4 identifiers, and mandatory SQLx migrations.
- Whole-list snapshots with revision checks as the initial save approach; reduced transfer is deferred.

Evidence: user confirmations recorded as D005, D006, D018–D024 in [Decisions](decisions.md). This completes the documentation milestone, not application implementation. Remaining behavior and operational details are assigned to M1–M11. The user has since reviewed M1, authorized M2, and requested M3 with JSON-only file transfer.

## M1 — Local keyboard editor

Scope: frontend tree model, command handling, visible-node navigation, editing, nesting, branch movement/deletion, collapsing, plain items/tasks, and session undo/redo. Add the local frontend Makefile entry point; extend it to start both processes when M2 adds the backend. Docker is not required.

Acceptance:

- The local prototype runs through a documented Makefile command.
- Enter creates a sibling after the current branch; Shift+Enter inserts a line break.
- Structural edits preserve descendant IDs and restore tree, focus, and cursor on undo/redo.
- Keyboard commands do not interrupt ordinary text editing or IME composition.
- Task conversion and completion follow the agreed rules.
- Empty lists and keyboard focus always provide a way to continue editing.

Verification: tree-command checks and browser interaction scenarios from [Editor behavior](editor-behavior.md); evidence is recorded in [M1 implementation](plans/m1-local-editor.md). The user reviewed the editing feel, requested follow-up changes, committed M1, and moved to M2. No persistence or draft recovery is provided at this milestone.

## M2 — Database, ownership, and autosave

Scope: backend API, users/lists/items, migrations, list management, ownership authorization, revision-checked saves, and save indicators. Extend `make dev` to manage frontend and backend processes. Add native migration and verification targets.

Agreed: M2 uses one provisioned local user without login. Resolve that identity on the server; do not accept a client-supplied owner as authentication. Keep owner-scoped queries and foreign keys so production authentication can be added without redesigning list ownership. Bind the development server to loopback and clearly identify this as local-only operation. Login and production access protection are deferred to M11.

M2 initially shipped with 2,000 items/list (raised to 5,000 in M6a), 32 levels, 32 KiB/item, 200 title characters, and a 1 MiB request-body limit. List deletion is permanent after confirmation; user-driven list ordering remains deferred.

Acceptance:

- A user can create, rename, reopen, and delete multiple lists using the agreed deletion behavior. Rename is initiated directly from the list heading; update the sidebar and breadcrumb consistently, and save through the revision-checked API.
- The database can be created from migrations and preserves data across server restarts.
- API access cannot read or mutate another user's lists, including through submitted item IDs.
- Indent/outdent commits the row diff, sibling ordering, and revision atomically without copying descendants.
- Conflicting revisions return a conflict without silently overwriting data.
- Slow/out-of-order responses cannot falsely mark newer local changes saved.
- The server handles transaction and commit failures with rollback.

Verification: disposable SQLite integration checks for ownership, constraints, revision conflicts, and migration application; browser reload and slow-save scenarios. Full draft recovery and conflict-resolution UI belong to M4. See the [M2 implementation record](plans/m2-persistence.md) for evidence and limitations.

## M3 — JSON portability

Scope: versioned JSON, local preview, current-list export, all-saved-lists export, and atomic new-copy import. Markdown file import/export was excluded from M3; it is now a separate M6a follow-up. Rendering Markdown in item text remains M9.

Acceptance:

- JSON preserves supported content, order, nesting, and IDs on export/read, including literal text that resembles Markdown.
- Current-list export includes current local edits. All-list export flushes pending changes and reads one consistent owned server snapshot.
- Preview identifies file contents without writing; import assigns new IDs and never overwrites existing lists or ownership.
- Invalid input or a database failure cannot leave a partial import.
- Unsupported versions/fields, duplicate IDs, and limit violations produce explicit errors.
- Batch limits are documented: 8 MiB, 100 lists, 10,000 items, plus existing per-list/save limits.

Verification: shared cross-language fixture and format tests, transactional failure/ownership integration tests, and browser download/preview/import workflows. See [M3 implementation](plans/m3-json-transfer.md).

## M4 — Draft recovery and conflicts

Scope: IndexedDB drafts, restore preview/copy, conflict UI, and safe retry/reconciliation. Full offline editing and automatic merging remain outside the proposed scope.

Acceptance:

- Reload after an unacknowledged edit offers recovery without replacing newer server content.
- Editing the same list in two tabs preserves both versions on conflict.
- A lost response does not cause an unsafe duplicate write or a false saved state.
- IndexedDB/quota errors are visible, and users can export their local version.
- Drafts are scoped by server and owner and are not exposed to another signed-in user.

Verification: interrupted requests, reload, two-tab edits, local-storage failures, scope isolation, and M3 schema upgrade using disposable data. See [recovery behavior](recovery.md) and the [M4 implementation record](plans/m4-draft-recovery.md).

## Next milestones — local improvements first

Hosting is undecided. Local product improvements do not depend on deployment or production authentication. M5–M10 are the proposed working order; each milestone still needs detailed design before implementation. M11/M11a access and M11c deployment remain mandatory before exposing the application beyond localhost, but does not block native local work. Later integrations and optimization have their own dependencies rather than a blanket dependency on deployment.

### M5 — Links and long-text editing

Outcome: open links from item text, keep long URLs compact in navigation mode, and make the full original text comfortable to edit. Requested during M4 review and authorized after the user committed the preceding work. This local improvement and can ship independently of Markdown rendering in M9.

Acceptance:

- Recognize HTTP/HTTPS links and provide an accessible way to open them without accidentally entering edit mode or triggering tree commands.
- Show long URLs compactly in navigation mode; truncation affects presentation only, never stored text or the target URL.
- Editing reveals the complete original URL and surrounding text. The textarea wraps and grows with its content so editing a long item is not restricted to a single visible line.
- Preserve keyboard navigation, caret/selection, IME input, undo/redo, autosave, and literal JSON round-trip.
- Define safe URL handling and how link activation coexists with click-to-edit before implementation. Do not fetch remote page metadata implicitly.

Verification: 34 frontend tests, 31 isolated browser scenarios, frontend build, and visual inspection. See [M5 implementation](plans/m5-links-editing.md).

Open design: allow a readable link label and/or an accompanying comment. The user suggested this as a possibility; decide whether ordinary item text, future Markdown links (M9), or separate item notes (M7) provide it before adding fields or changing the JSON schema.

### M6 — Search

Outcome: search across the current user's lists and navigate to the matching item. Authorized after the user reviewed and committed M5. Initial behavior uses a modal with retained query, contextual results, and explicit refresh; see [M6 implementation](plans/m6-search.md).

Acceptance:

- Search results respect ownership and identify the list, matching item, and enough ancestor context to distinguish similar matches.
- Selecting a result opens its list, expands the ancestor path, scrolls the item into view, and gives it keyboard focus with a visible match indication, without changing stored content.
- Switching to a result preserves pending edits and the existing per-list autosave/history behavior.
- Define keyboard navigation of results, loading/empty/error states, and behavior when a result changes or is deleted before activation.
- Decide searched fields, matching/highlighting rules, handling of current unsaved edits, and expected scale before implementation. Choose indexing based on measured needs.

Implemented defaults: retained-query modal, literal Unicode case-insensitive matching, contextual snippets, checked target activation, view-only highlights, and explicit snapshot/result limits. See [Search behavior](search.md). Larger-scale indexing and fuzzy matching require separate design.

### M6a — Format adapters and outline-Markdown transfer

Outcome: add import/export formats as small Rust modules with separate direction capabilities, reusing a common model, preview, validation, and atomic new-copy persistence. JSON remains supported with its existing strict contract; add the agreed outline-Markdown dialect. This follow-up was authorized after agreement on the outline dialect; it is implemented and verified for review without renumbering established milestones.

Acceptance:

- Preserve current JSON behavior, local unsaved export, ownership isolation, all-or-nothing import, and lost-response handling.
- Read-only conversion/preview does not persist anything. Warnings explain unsupported constructs and format losses before confirmation.
- Follow the agreed [outline-Markdown contract](data-formats.md#outline-markdown-contract--m6a): top-level paragraphs are root items; only explicit indentation creates children; task markers are explicit.
- New formats can support import, export, or both without embedding parsing in HTTP handlers or SQL storage. No dynamic plugin loader is required.
- Verify a synthetic 3,000–5,000-item list before choosing a higher shared item limit, so the user's largest current sample can be handled intact if feasible. The verified current limit is now 5,000; do not silently split or truncate.
- Test synthetic dialect fixtures, escaping and multiline rules, structural export/import round-trips, malformed input, limits, preview/cancel, and transactional persistence. The user's personal sample is reference material, not required committed test data.

Implemented defaults: compiled enum dispatch, read-only conversion endpoints, explicit multiline/escaping rules, and a synchronized 5,000-item limit after scale verification. See [adapter boundaries](code-structure.md#format-adapters--m6a) and [M6a implementation](plans/m6a-format-adapters.md).

### M6b — Persistent outline view state

Outcome: remember which branches are collapsed or expanded per user/list in the database, shared across browsers and devices on the same installation. Requested after the user accepted the current M6a behavior; this is UI-state work, independent of import/export. Implementation is complete, verified, and accepted by the user on 2026-10-27.

Acceptance:

- Restore collapsed/expanded branches for the same list without marking item content dirty or changing list revisions or undo history.
- Scope remembered state by installation, user, and list identity; another account or installation must not inherit it.
- Ignore stale item IDs after deletion or replacement. Imported copies have new IDs and do not inherit the source list's view state through file transfer.
- Storage failures must not prevent ordinary editing; define a non-blocking fallback and verify reload/list-switch behavior.
- Keep JSON/Markdown content formats unchanged; collapse state remains separate presentation data.

Implemented defaults: database-backed collapsed IDs per user/list with a separate revision; only manual changes are saved. Temporary search/undo expansion stays local.

Refresh on opening a list and visible focus/visibility return. Rebase per-item pending changes after revision conflicts, show retryable failures, and preserve focused editor visibility. No real-time push is included. See [M6b implementation](plans/m6b-outline-state.md).

### M7 — Item notes

Outcome: separate plain-text notes attached to items/tasks. Implemented defaults: modal Apply/Cancel, one undoable commit, 64 KiB note limit, content autosave/recovery, note search, additive SQL migration, and JSON v2 with v1 input compatibility. Markdown/HTML stay literal until M9; outline-Markdown export refuses lists with notes to avoid loss. See [Note behavior](notes.md) and [M7 implementation](plans/m7-item-notes.md).

### M8 — Tags and filtering

Outcome: attach tags and filter without rewriting the tree. Initial defaults: exact case-sensitive names scoped through owned items, 12 tags/item, 40 Unicode characters/name, Apply/Cancel history, and a single-tag current-list projection showing ancestor context. Filtered structural edits are locked; undo/search/clear restore complete context. Additive migration and JSON v3 with v1/v2 input compatibility preserve metadata; Markdown refuses tagged lists. See [Tag behavior](tags.md) and [M8 implementation](plans/m8-tags-filtering.md).

### M9 — Markdown inside item text

Outcome: optional Markdown display with unchanged source editing, storage and JSON v3. Implemented defaults: allowlisted formatting, separate HTTP/HTTPS opening controls, literal HTML, text-only image placeholders, and optional note preview. See [display contract](markdown-display.md) and [implementation record](plans/m9-markdown-display.md). This does not change Markdown file import/export.

### M10 — Task dates

Outcome: one date-only deadline, as selected by the user. Implemented defaults: Date/D modal Apply/Cancel, clear and undo/redo, local-calendar Today/Overdue/Done badges, literal date search, owned snapshot persistence and JSON v4 with v1–v3 input compatibility. Dates remain attached when converting plain items/tasks. No reminders, recurrence or scheduled-start field. See [Due dates](dates.md) and [implementation record](plans/m10-task-dates.md).

### M11 — Accounts and browser sessions

Replanned on 2026-10-28 at the user's request: design access before deployment. No public self-registration. Proposed scope: explicit first-admin bootstrap preserving the existing user's ownership, password login/change, persistent cookie sessions, expiry/renewal/revocation and safe reauthentication with pending edits. Resolve the owner per authenticated request; replace the globally fixed local identity in authenticated mode. Verify isolation across all routes and browser caches/drafts.

Implemented with axum-login 0.18.0, tower-sessions 0.14.0, SQLx store 0.15.0 and Argon2id. Includes explicit existing-owner administrator bootstrap, browser login/session management, password change, expiry/revocation, request-scoped ownership and draft-safe same-owner reauthentication. See [Authentication](authentication.md) and [implementation record](plans/m11-authentication.md). Implementation defaults await user review; deployment remains M11c.

### M11a — Administrator-managed accounts

Implemented after authorization on 2026-10-29: separate /admin page, friend-only user creation, single-use 24-hour activation/reset links delivered manually, disable/reactivate, revocation, last-admin protection and existing local recovery. Private content remains owner-scoped. No public sign-up, SMTP, role promotion or account deletion. See [Account administration](account-administration.md) and [implementation record](plans/m11a-account-administration.md). Implementation defaults await review.

### M11b — Personal API tokens

Proposed separate milestone for integrations: scoped random bearer tokens, digest-only secret storage, explicit expiry, creation/last-use metadata, revocation and rotation. Browser login uses sessions and does not depend on this milestone. API tokens are not a prerequisite for deployment unless a selected deployment requirement needs them. Do not confuse them with activation/reset secrets or Telegram bot credentials.

### M11c — Deployment and recovery

Former M11 deployment scope moves here; M12–M15 numbers stay unchanged. Hosting remains undecided. Prerequisites: M11 and M11a implemented and accepted; selected host/HTTPS/proxy configuration; backups and restore policy.

Scope: Docker image/Compose if selected, native/container Makefile commands, persistent storage, migration startup, protected installation and operating instructions. Verify authentication/owner isolation in the deployed configuration, restart persistence, upgrade failure behavior and consistent SQLite backup restoration. Deployment must not enable the local development identity bypass. Publishing/modifying a real host requires a concrete deployment request.

### M12 — Telegram Inbox

Outcome: link a Telegram account to the authenticated application user and capture text or links into a chosen Inbox list. No LLM is needed. Production identity is supplied by M11 and protected deployment by M11c. Implement before considering AI-assisted Telegram capture; implementation is deferred.

Acceptance:

- Link accounts through a short-lived, single-use token initiated by the authenticated user; support disconnecting. Never trust a submitted application owner ID.
- Capture private messages as plain items in the configured owned list and reply with confirmation and a link to the captured item. Preserve literal text and URLs.
- Deduplicate delivered updates using durable processing state; retries and restarts must not create duplicate items or acknowledge an uncommitted write.
- Route captures through shared application validation and transaction boundaries. Coordinate revision changes with open web sessions without silently overwriting pending edits.
- Keep the bot token server-side, respect ownership and existing limits, and provide actionable failure handling for deleted/unavailable Inbox lists.
- Support long polling for native development without a public inbound endpoint. Decide polling versus HTTPS webhook for deployment before implementation.

Open design: bot ownership/configuration, Inbox selection and creation, capture behavior for multiline text, item-level web links, and inbound rate limits. Full tree editing, voice transcription, reminders, group-chat capture, and AI interpretation are separate later proposals, not included in this milestone.

### M13 — Optional AI commands

This milestone does not depend on Telegram or a hosting choice; choose explicit server-side API configuration before implementation.

Outcome: explicitly invoked assistance for a selected item or branch, independent of ordinary editing and Telegram capture. Initial commands: turn pasted text into a tree, break an item into subtasks, shorten/rephrase text, and summarize a branch. Tag suggestions depend on M8. Implementation is deferred; provider/model selection remains open.

Acceptance:

- Invoke AI only through an explicit action; do not send content while typing or automatically scan all lists.
- Send only the selected content and bounded context. Preview the proposed result before applying it; cancellation leaves content unchanged, and application is one undoable editor operation.
- Validate structured results through existing content/depth/size limits and generate item IDs locally. Reject malformed responses without partial application.
- Detect changes to the target while a request is running; never apply a stale response over newer edits or another list.
- Use a configurable economical model, input/output limits, request/concurrency limits, and a server-enforced monthly spending cap with usage visibility. Define conservative accounting for in-flight, failed, or uncertain requests before implementation; a provider dashboard budget alone is insufficient.
- Store provider credentials server-side. Make the external transmission of selected content clear before use; ordinary editing, search, JSON transfer, and Telegram Inbox work without AI configuration.
- Handle timeout/provider/budget failures without losing editor content or automatically duplicating chargeable requests.

Open design: provider and model, pricing/accounting policy, command UI and preview, and provider data handling. Do not assume a specific monthly cost until representative requests are measured. Whole-workspace chat, retrieval/vector search, autonomous background agents, and voice processing are outside this milestone.

### M14 — Transfer-size optimization

Outcome: reduce the data exchanged for edits after the reliable snapshot implementation exists. Measure payload sizes and latency for agreed list sizes first. Compare compression, coalescing, conditional reads, patches, or operation-based writes; no specific replacement protocol is agreed yet.

Acceptance: representative indent/outdent and text edits exchange measurably fewer bytes against the recorded baseline; revision checks, retry/idempotency, draft recovery, and atomic writes remain correct. Document before/after measurements and protocol compatibility. Optimization must not turn partial failures into lost edits. Establish a quantitative target from the baseline before implementation.

### M15 — Active and archived lists

Outcome: distinguish active lists from archived lists, archive without losing content, restore to active, and allow explicit deletion. Requested as a future feature; implementation is deferred.

Acceptance:

- Active and archived lists have separate, understandable navigation; archiving preserves list/item IDs, hierarchy, and content.
- Users can archive and restore owned lists without losing pending edits or drafts. Concurrent changes follow revision/conflict rules.
- Define how search includes/excludes archives, and label archived results clearly when included. Define whether archived content can be edited and how switching/reload/deep links behave.
- Deletion remains available with explicit confirmation. Current deletion is permanent; archive is not a trash bin, and recoverable deletion requires separate scope.
- Use an additive migration and update API validation, ownership checks, search, and JSON portability under an explicit backward-compatible format policy. Do not silently drop archive state from a full portable export.

Open design: archive placement/order, read-only versus editable archives, default search scope and inclusion control, deleted-list recovery, and conversion warnings for formats that cannot represent archive state.

## Remaining product details

Resolve within the relevant milestone rather than blocking all work now:

- M1: empty-item Enter behavior, task completion propagation, completion visibility, and deletion focus.
- After M2: soft-delete/trash recovery and user-driven list ordering remain unimplemented. Revisit scale and limits based on real usage.
- After M3: ID-preserving restore and archive packaging require separate scope; outline-Markdown transfer is tracked in M6a.
- M11c: mobile support expectations and the release support matrix if required.

Keep recommendations marked as proposals until the user agrees; do not infer acceptance merely because a milestone mentions them.

## Roadmap renumbering — 2026-10-26

M0–M4 are unchanged. Earlier decision entries retain the milestone numbers used when recorded; the current roadmap supersedes that ordering and its deployment dependencies.

| Previous | Current | Scope |
| --- | --- | --- |
| M12 | M5 | Links and long-text editing |
| M8 | M6 | Search |
| M6 | M7 | Notes |
| M7 | M8 | Tags |
| M11 | M9 | Markdown rendering |
| M9 | M10 | Dates |
| M5 | M11 | Protected deployment and recovery |
| M13 | M12 | Telegram Inbox |
| M14 | M13 | AI commands |
| M10 | M14 | Transfer optimization |

## Access-first replan — 2026-10-28

The user requested account/token design and admin-created friends before deployment, without public self-registration. M11 now covers identity/sessions; M11a administration; M11b optional integration credentials; former deployment work becomes M11c. Detailed mechanisms in [Access control](access-control.md) are proposals, not implementation approval. M10 date assignment/display was reviewed positively; its full acceptance status is unchanged.

## First-release sequence — 2026-10-29

Agreed: finish M11a locally, then run a release-readiness pass (reauthentication/drafts, two-user isolation, database upgrade and backup restoration), followed by remaining small UI/error/empty-state polish. Railway availability does not block this work. API tokens/integrations can follow; deployment remains M11c and is not authorized by this implementation request.
