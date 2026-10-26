# Documentation

Updated: 2026-10-26. This is a working draft for discussion, not a fully approved specification.

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
- The hosting environment and access protection are still undecided.
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

Multiple lists; creating, editing, moving, and deleting branches; collapsing; plain items and tasks; undo/redo; autosave; draft recovery; JSON/Markdown import/export. The primary interface targets a desktop browser; each user can own multiple lists. Account provisioning and authentication are still undecided.

Outside the proposed initial scope: collaborative editing, full offline support, attachments, reminders, recurring tasks, and public lists. This is a proposal, not a permanent rejection of these features.

## Open decisions and roadmap

See [Milestones](milestones.md) for the complete roadmap and when each decision is needed.

The core direction is agreed; M0 is complete as a documentation milestone. Editor details such as conversion completion semantics, exact shortcuts, and empty-item behavior can be resolved during M1. Notes, tags, search, and dates are deferred to M6–M9; transfer-size optimization is M10.

Before persistence: decide account provisioning/identity, expected scale, and initial limits. UUIDv4, normalized tables, SQLx migrations, and initial snapshot saves are agreed. Before deployment: choose production authentication, hosting details, and backup policy. Import format details are resolved before the portability milestone.

The roadmap is proposed; implementation has not started and requires a follow-up request.
