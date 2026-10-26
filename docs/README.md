# Documentation

Updated: 2026-10-26. The core direction is agreed. M1 is implemented for local review; remaining design details are tracked by milestone.

## Agreed with the user

- Self-hosting, nested lists, and convenient keyboard editing.
- JSON and Markdown import/export.
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
- [Architecture](architecture.md): components, persistence, conflicts, deployment.
- [Editor behavior](editor-behavior.md): focus, tree operations, commands, history.
- [Database and migrations](database.md): identifiers, ownership, schema, ordering, and migration management.
- [Data formats](data-formats.md): model, JSON, Markdown, import.
- [Decisions](decisions.md): agreements and proposals.
- [Codex workflow](codex-workflow.md): instructions, configuration, verification.

## Proposed initial scope

Multiple lists; creating, editing, moving, and deleting branches; collapsing; plain items and tasks; undo/redo; autosave; draft recovery; JSON/Markdown import/export. The primary interface targets a desktop browser; each user can own multiple lists. M2 uses a server-resolved local user without login; production authentication is assigned to M5.

Outside the proposed initial scope: collaborative editing, full offline support, attachments, reminders, recurring tasks, and public lists. This is a proposal, not a permanent rejection of these features.

## Open decisions and roadmap

See [Milestones](milestones.md) for the complete roadmap and when each decision is needed.

The core direction is agreed; M0 is complete as a documentation milestone. Editor details such as conversion completion semantics, exact shortcuts, and empty-item behavior can be resolved during M1. Notes, tags, search, and dates are deferred to M6–M9; transfer-size optimization is M10.

Before persistence: decide expected scale and initial limits. The initial identity is one local user without login. UUIDv4, normalized tables, SQLx migrations, and initial snapshot saves are agreed. Before deployment: choose production authentication, hosting details, and backup policy. Import format details are resolved before the portability milestone.

M1 implementation was authorized and is ready for local review. It is session-only, with one disposable list; no backend or autosave is implemented. See the root README for commands and the [M1 implementation record](plans/m1-local-editor.md) for verification. Further milestones have not started.
