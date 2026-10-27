# Documentation

Updated: 2026-10-26. The core direction is agreed. M1 was reviewed and committed by the user; M2 persistence is implemented; M3 was reviewed and committed; M4 draft recovery was reviewed and accepted by the user; M5 links and long-text editing is implemented for local review; deployment is deferred to M11 while hosting is undecided. Remaining design details are tracked by milestone.

## Agreed with the user

- Self-hosting, nested lists, and convenient keyboard editing.
- JSON-only file import/export. Markdown inside item text is a separate later milestone (M9).
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
- M2 uses one local user without login; production authentication is deferred to M11 before deployment.
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

Multiple lists; creating, editing, moving, and deleting branches; collapsing; plain items and tasks; undo/redo; autosave; draft recovery; JSON import/export. The primary interface targets a desktop browser; each user can own multiple lists. M2 uses a server-resolved local user without login; production authentication is assigned to M11.

Outside the proposed initial scope: collaborative editing, full offline support, attachments, reminders, recurring tasks, and public lists. This is a proposal, not a permanent rejection of these features.

## Open decisions and roadmap

See [Milestones](milestones.md) for the complete roadmap and when each decision is needed.

The core direction is agreed; M0 is complete as a documentation milestone. Editor details such as conversion completion semantics, exact shortcuts, and empty-item behavior can be resolved during M1. Local improvements are ordered as M5 links/editing, M6 search, M7 notes, M8 tags, M9 Markdown rendering, and M10 dates. Deployment is M11, Telegram M12, AI M13, and measured transfer optimization M14.

Before persistence: decide expected scale and initial limits. The initial identity is one local user without login. UUIDv4, normalized tables, SQLx migrations, and initial snapshot saves are agreed. Before deployment: choose production authentication, hosting details, and backup policy. Import format details are resolved before the portability milestone.

M2 is implemented with a loopback-only backend, embedded migrations, user-owned multiple lists, heading rename, deletion confirmation, and revision-checked autosave. See the root README for commands and the [M2 implementation record](plans/m2-persistence.md) for verification. M3 provides JSON import/export. M4 adds local drafts and conflict actions; authentication remains M11.

M3 implementation and verification: [JSON portability record](plans/m3-json-transfer.md). Markdown file transfer is excluded; Markdown rendering in item text is M9.

M5 tracks clickable links, compact URL display, and full, content-sized text editing. Link labels or accompanying comments remain an open design option; see the [milestone](milestones.md#m5--links-and-long-text-editing).

M12 adds a future Telegram Inbox for capturing text and links; M13 adds optional AI commands on selected content with preview, undo, and spending controls. Telegram depends on protected deployment in M11; AI can be designed independently of hosting. Detailed design and provider selection remain open. See [Milestones](milestones.md).
