# Decision log

Statuses: **Agreed** — explicitly specified by the user; **Proposed** — needs discussion; **Deferred** — outside the currently proposed scope; **Superseded proposal** — replaced by another unapproved proposal.

| ID | Date | Status | Decision and consequences |
| --- | --- | --- | --- |
| D001 | 2026-10-26 | Agreed | Self-hosting and JSON/Markdown import/export are core requirements |
| D002 | 2026-10-26 | Agreed | Convenient keyboard editing with our own shortcuts; compatibility with another product is not required |
| D003 | 2026-10-26 | Agreed | Autosave and draft recovery are sufficient for v1; full offline editing is not required |
| D004 | 2026-10-26 | Agreed | Current work is documentation and discussion; the user makes commits |
| D005 | 2026-10-26 | Agreed | Svelte/TypeScript/Vite + Rust/Axum + SQLite; one server serves the static frontend |
| D006 | 2026-10-26 | Agreed | Client-side commands and undo/redo; the server validates snapshots and revisions |
| D007 | 2026-10-26 | Superseded proposal | One JSON snapshot per list in SQLite; replaced by the normalized-row proposal D018 |
| D008 | 2026-10-26 | Proposed | JSON preserves the portable model; Markdown supports an explicitly limited subset |
| D009 | 2026-10-26 | Superseded proposal | A single owner was the initial assumption; D017 establishes users owning multiple lists; authentication and hosting remain undecided |
| D010 | 2026-10-26 | Deferred | Collaborative editing, CRDTs, attachments, and reminders are outside the proposed v1 |
| D011 | 2026-10-26 | Agreed | Support plain items and tasks with checkboxes |
| D012 | 2026-10-26 | Agreed | Enter creates a sibling after the current branch without splitting text; Shift+Enter inserts a line break |
| D013 | 2026-10-26 | Agreed | Deploy with Docker at this stage; specific hosting, Compose, and authentication remain undecided |
| D014 | 2026-10-26 | Agreed | Clarifies D013: Docker for deployment, native local execution also supported; run, build, and check commands through Makefile |
| D015 | 2026-10-26 | Agreed | Use English for repository content; continue chatting in Ukrainian |
| D016 | 2026-10-26 | Agreed | Remove external product references and links; describe the editor through its own requirements and behavior |
| D017 | 2026-10-26 | Agreed | Each user can have multiple lists; account provisioning and authentication are still undecided |
| D018 | 2026-10-26 | Agreed | Replace D007 with normalized users, lists, and items; same-list parent references and atomic revision-checked writes |
| D019 | 2026-10-26 | Agreed | UUIDv4 string identifiers; create item IDs in the client before saving |
| D020 | 2026-10-26 | Agreed | SQLx SQL migration files in backend/migrations; database migration history tracks versions/checksums; applied files are immutable |

| D021 | 2026-10-26 | Agreed | Baseline navigation/edit modes and conversion between plain items and tasks; exact shortcut and completion details remain adjustable |
| D022 | 2026-10-26 | Agreed | Notes, tags, search, and dates belong to later milestones, outside the initial core release |
| D023 | 2026-10-26 | Agreed | Use whole-list snapshot saves with revision checks as the initial approach; revisit if measurements justify a change |
| D024 | 2026-10-26 | Agreed | Reducing transfer size and optimizing the exchange protocol is a later milestone, not a prerequisite for the core editor |

| D025 | 2026-10-26 | Agreed | Begin M1 local editor implementation after the user committed the design documents; later milestones remain unstarted |

| D026 | 2026-10-26 | Agreed | M1 feedback: Del deletes a branch in navigation mode; keyboard guide is modal; heading-based list renaming is planned for M2 |

| D027 | 2026-10-26 | Agreed | M2 uses one server-resolved local user without login; production authentication is deferred to M5 before deployment; ownership boundaries remain enforced |

| D028 | 2026-10-26 | Agreed | Begin M2 implementation after user review/commit of M1; local-only persistence, list management, and snapshot autosave are in scope |

| D029 | 2026-10-26 | Agreed | Establish simple module boundaries during M2: UI, workspace, editor, autosave, transport, validation, HTTP, and SQLite storage; preserve direct calls and avoid speculative frameworks |

| D030 | 2026-10-26 | Agreed | M3 is JSON-only; supersedes the Markdown file-transfer portion of D001/D008. Defer Markdown rendering inside item text to M11, separate from file transfer |

Record material changes to agreed decisions as new decisions referencing those they replace. Do not mark a proposal as agreed without the user's response.
