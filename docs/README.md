# Documentation

Updated: 2026-10-29. The core direction is agreed. M1 was reviewed and committed by the user; M2 persistence is implemented; M3 was reviewed and committed; M4 draft recovery was reviewed and accepted by the user; M5 links and long-text editing was reviewed and committed; M6 search is implemented for local review; deployment is deferred to M11c while access is designed in M11/M11a and hosting is undecided. Remaining design details are tracked by milestone.

## Agreed with the user

- Self-hosting, nested lists, and convenient keyboard editing.
- JSON file transfer is implemented; outline-Markdown transfer and Rust adapters are implemented and accepted in M6a. Markdown rendering inside item text remains separate in M9.
- Each user can have multiple lists.
- Stack: Svelte/TypeScript/Vite + Rust/Axum + SQLite.
- UUIDv4 IDs; normalized users/lists/items; SQLx migrations are required.
- Initial save approach: whole-list snapshots with revision checks.
- Navigation/edit modes and conversion between plain items and tasks.
- Notes, tags, search, Markdown display and due dates extend the initial core; transfer-size optimization remains later work.
- Plain items and tasks with checkboxes.
- Enter creates a new item after the current branch without splitting text; Shift+Enter inserts a line break within the text.
- Convenient keyboard editing with our own shortcuts.
- Autosave and draft recovery are sufficient for v1; full offline editing is not required.
- Discuss and document architecture and behavior before implementation.
- Deploy with Docker; local execution can run without Docker.
- Makefile is the common entry point for running, building, and checking.
- M2 uses one local user without login; production authentication is M11/M11a before M11c deployment.
- No public self-registration for now; design access before deployment, with an admin page for adding friends.
- The hosting environment and detailed production authentication policies are still undecided.
- The user makes commits.
- Repository content is in English; chat remains in Ukrainian.

## Guide

- [Account administration](account-administration.md): friend creation, activation/reset links, blocking and revocation.
- [Authentication](authentication.md): implemented login, bootstrap, sessions, expiry and local recovery.
- [Access control](access-control.md): proposed accounts, sessions, administrator invitations and token lifecycle.
- [Milestones](milestones.md): outcomes, dependencies, acceptance criteria, and remaining decisions.
- [Code structure](code-structure.md): module responsibilities, dependencies, and extension points.
- [Architecture](architecture.md): components, persistence, conflicts, deployment.
- [Editor behavior](editor-behavior.md): focus, tree operations, commands, history.
- [Database and migrations](database.md): identifiers, ownership, schema, ordering, and migration management.
- [Tags and filtering](tags.md): tag identity, current-list projection, command guards, and portability.
- [Due dates](dates.md): calendar semantics, editing, status, persistence and JSON compatibility.
- [Markdown display](markdown-display.md): supported syntax, safe links, source editing, and limits.
- [Item notes](notes.md): editing, persistence, search, and JSON compatibility.
- [Search](search.md): cross-list results, navigation, local edits, and limits.
- [Draft recovery](recovery.md): local persistence, identity scopes, recovery, and conflict choices.
- [Data formats](data-formats.md): model, versioned JSON, outline Markdown, limits, and adapter behavior.
- [Decisions](decisions.md): agreements and proposals.
- [Codex workflow](codex-workflow.md): instructions, configuration, verification.

## Proposed initial scope

Multiple lists; creating, editing, moving, and deleting branches; collapsing; plain items and tasks; undo/redo; autosave; draft recovery; JSON import/export. The primary interface targets a desktop browser; each user can own multiple lists. M2 uses a server-resolved local user without login; production authentication is assigned to M11.

Outside the proposed initial scope: collaborative editing, full offline support, attachments, reminders, recurring tasks, and public lists. This is a proposal, not a permanent rejection of these features.

## Open decisions and roadmap

See [Milestones](milestones.md) for the complete roadmap and when each decision is needed.

The core direction is agreed; M0 is complete as a documentation milestone. Editor details such as conversion completion semantics, exact shortcuts, and empty-item behavior can be resolved during M1. Local improvements are ordered as M5 links/editing, M6 search, M7 notes, M8 tags, M9 Markdown rendering, and M10 dates. Access is M11/M11a, integration tokens M11b, deployment M11c, Telegram M12, AI M13, and measured transfer optimization M14.

Before persistence: decide expected scale and initial limits. The initial identity is one local user without login. UUIDv4, normalized tables, SQLx migrations, and initial snapshot saves are agreed. Before deployment: choose production authentication, hosting details, and backup policy. Import format details are resolved before the portability milestone.

M2 is implemented with a loopback-only backend, embedded migrations, user-owned multiple lists, heading rename, deletion confirmation, and revision-checked autosave. See the root README for commands and the [M2 implementation record](plans/m2-persistence.md) for verification. M3 provides JSON import/export. M4 adds local drafts and conflict actions; authentication remains M11.

M3 implementation and verification: [JSON portability record](plans/m3-json-transfer.md). M3 shipped JSON-only; the later M6a agreement adds implemented outline-Markdown transfer. Markdown rendering in item text is M9.

M5 tracks clickable links, compact URL display, and full, content-sized text editing. Link labels or accompanying comments remain an open design option; see the [milestone](milestones.md#m5--links-and-long-text-editing).

M12 adds a future Telegram Inbox for capturing text and links; M13 adds optional AI commands on selected content with preview, undo, and spending controls. Telegram depends on protected deployment in M11; AI can be designed independently of hosting. Detailed design and provider selection remain open. See [Milestones](milestones.md).

M6a adds compiled Rust format adapters, outline-Markdown transfer, and a 5,000-item limit verified with synthetic workflows. M15 tracks active/archived lists, restore, and deletion; search scope and archived editing remain design questions. M6a was accepted after user export verification; M15 is not implemented.

M6b was verified and accepted by the user: per-user/list database collapse preferences separately from import/export, with independent revisions, retry, and refresh on list opening/window return. See [M6b implementation](plans/m6b-outline-state.md).

M7 adds plain-text item notes, note search and JSON v2 while retaining v1 import. It was verified and accepted by the user; M9 adds optional note preview.

M8 adds item tags, safe current-list filtering, tag search and JSON v3 with v1/v2 input compatibility. It was reviewed and committed by the user.

M9 adds optional Markdown display for items and note drafts, preserving source and JSON v3 without database changes. See [Markdown display](markdown-display.md).

M9 was committed by the user. M10 implements the agreed single date-only deadline, with JSON v4 and an additive migration; implementation defaults await review.

Access-first replan: M11 accounts/login/sessions → M11a admin-managed friends → M11c deployment. M11b API tokens are separate integration work, not required for cookie login. M11 authentication is now implemented for review; M11a/M11b/M11c remain separate.

M11a is implemented for local review following the agreed 2026-10-29 sequence. Release-readiness checks (including backup restoration) and remaining polish follow; Railway does not block local work.
