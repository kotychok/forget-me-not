# Documentation

Updated: 2026-10-26. The core direction is agreed. M1 was reviewed and committed by the user; M2 persistence is implemented; M3 was reviewed and committed; M4 draft recovery is ready for local review. Remaining design details are tracked by milestone.

## Agreed with the user

- Self-hosting, nested lists, and convenient keyboard editing.
- JSON-only file import/export. Markdown inside item text is a separate later milestone (M11).
- Each user can have multiple lists.
- Stack: Svelte/TypeScript/Vite + Rust/Axum + SQLite.
- UUIDv4 IDs; normalized users/lists/items; SQLx migrations are required.
- Initial save approach: whole-list snapshots with revision checks.
- Navigation/edit modes and conversion between plain items and tasks.
- Notes, tags, search, dates, and transfer-size optimization are later milestones.
- Plain items and tasks with checkboxes.
- Enter creates a new item after the current branch without splitting text; Shift+Enter inserts a line break within the text.
- Convenient keyboard editing with our own shortcuts.
- Autosave and draft recovery are sufficient for v1; full offline editing is not required.
- Discuss and document architecture and behavior before implementation.
- Deploy with Docker; local execution can run without Docker.
- Makefile is the common entry point for running, building, and checking.
- M2 uses one local user without login; production authentication is deferred to M5 before deployment.
- The hosting environment and production authentication mechanism are still undecided.
- The user makes commits.
- Repository content is in English; chat remains in Ukrainian.

## Guide

- [Milestones](milestones.md): outcomes, dependencies, acceptance criteria, and remaining decisions.
- [Code structure](code-structure.md): module responsibilities, dependencies, and extension points.
- [Architecture](architecture.md): components, persistence, conflicts, deployment.
- [Editor behavior](editor-behavior.md): focus, tree operations, commands, history.
- [Database and migrations](database.md): identifiers, ownership, schema, ordering, and migration management.
- [Draft recovery](recovery.md): local persistence, identity scopes, recovery, and conflict choices.
- [Data formats](data-formats.md): model, versioned JSON, limits, import/export.
- [Decisions](decisions.md): agreements and proposals.
- [Codex workflow](codex-workflow.md): instructions, configuration, verification.

## Proposed initial scope

Multiple lists; creating, editing, moving, and deleting branches; collapsing; plain items and tasks; undo/redo; autosave; draft recovery; JSON import/export. The primary interface targets a desktop browser; each user can own multiple lists. M2 uses a server-resolved local user without login; production authentication is assigned to M5.

Outside the proposed initial scope: collaborative editing, full offline support, attachments, reminders, recurring tasks, and public lists. This is a proposal, not a permanent rejection of these features.

## Open decisions and roadmap

See [Milestones](milestones.md) for the complete roadmap and when each decision is needed.

The core direction is agreed; M0 is complete as a documentation milestone. Editor details such as conversion completion semantics, exact shortcuts, and empty-item behavior can be resolved during M1. Notes, tags, search, and dates are deferred to M6–M9; transfer-size optimization is M10.

Before persistence: decide expected scale and initial limits. The initial identity is one local user without login. UUIDv4, normalized tables, SQLx migrations, and initial snapshot saves are agreed. Before deployment: choose production authentication, hosting details, and backup policy. Import format details are resolved before the portability milestone.

M2 is implemented with a loopback-only backend, embedded migrations, user-owned multiple lists, heading rename, deletion confirmation, and revision-checked autosave. See the root README for commands and the [M2 implementation record](plans/m2-persistence.md) for verification. M3 provides JSON import/export. M4 adds local drafts and conflict actions; authentication remains M5.

M3 implementation and verification: [JSON portability record](plans/m3-json-transfer.md). Markdown file transfer is excluded; Markdown rendering in item text is M11.

M12 tracks clickable links, compact URL display, and full, content-sized text editing. Link labels or accompanying comments remain an open design option; see the [milestone](milestones.md#m12--links-and-long-text-editing).

M13 adds a future Telegram Inbox for capturing text and links; M14 adds optional AI commands on selected content with preview, undo, and spending controls. Both are deferred until after M5; detailed design and provider selection remain open. See [Milestones](milestones.md).
