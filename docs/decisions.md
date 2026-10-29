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

| D031 | 2026-10-26 | Agreed | Begin M4 after user review/commit of M3: local draft persistence, safe recovery/copy, and conflict actions; no full offline editing or automatic merge |

| D032 | 2026-10-26 | Agreed | Escape cancels an untouched newly added item; existing items and items edited or structurally changed remain. Save notifications use an overlay without moving the editor; successful saves fade after a short notice, errors/conflicts remain visible |

| D033 | 2026-10-26 | Agreed deferral | Track clickable links, compact navigation display of long URLs, and full content-sized editing in M12. A readable link label or accompanying comment remains a proposal to coordinate with M6/M11 |

| D034 | 2026-10-26 | Agreed deferral | Keep cross-list search in M8; design contextual results and navigation to the matching item before implementation, including opening its list and revealing its ancestor path |

| D035 | 2026-10-26 | Agreed deferral | Add M13 Telegram Inbox (account linking and text/link capture without AI) and M14 explicitly invoked AI commands on selected content with preview, undo, and spending controls. Defer implementation; provider/model and detailed integration design remain open |

| D036 | 2026-10-26 | Agreed | Tab/Shift+Tab indent/outdent on item text in both navigation and editing, preserving the active item and mode. Supersedes navigation-mode page Tab behavior; Escape from navigation focuses the toolbar to retain a keyboard exit |

| D037 | 2026-10-26 | Agreed replan | Hosting remains undecided; move deployment later and remove it as a prerequisite for local product improvements. The current milestone numbering and mapping in milestones.md supersede earlier milestone references and blanket deployment dependencies; individual feature design remains open |

| D038 | 2026-10-26 | Agreed scope / implementation defaults | Begin reordered M5 after user commit: compact plain-text URL display, separate HTTP/HTTPS opening controls, full content-sized editing, and unchanged JSON/storage. Defaults: new-tab links, L for link focus, Escape back to item. Custom labels/comments remain deferred |

| D039 | 2026-10-27 | Agreed scope / implementation defaults | Begin M6 after user review and commit of M5. Defaults: retained-query search modal, literal case-insensitive titles/item search, read-only owned snapshot overlaid with local edits, contextual results, and checked reveal/focus without clearing history. Use explicit existing snapshot limits; defer dedicated indexing until measured needs justify it |

| D040 | 2026-10-27 | Agreed | Supersedes D030's Markdown file-transfer exclusion: plan outline-Markdown import/export with compiled Rust format adapters and separate direction capabilities. Top-level paragraphs are root items, explicit indentation determines hierarchy, and task markers determine checkbox state. JSON remains the full supported portable format; Markdown rendering stays M9. Track implementation and unresolved parsing/scale details in M6a |

| D041 | 2026-10-27 | Observed scale / proposed verification | The user's largest current sample has 2,976 list-marker lines plus prose, exceeding the present 2,000-item limit. Verify synthetic 3,000–5,000-item workflows before selecting a higher shared limit; do not silently split/truncate or change limits merely from file size |

| D042 | 2026-10-27 | Agreed deferral | Add M15 for active/archived lists, restoration to active, and explicit deletion. Search inclusion, archived editing, and persistence/portable schema details require design; archive is distinct from any future trash/recoverable-delete feature |

| D043 | 2026-10-27 | Agreed implementation / verified default | Implement M6a before the user imports their private file through the UI; remove that file from the repository (user retains a separate copy). JSON and outline-Markdown use pure Rust adapters and read-only conversion endpoints, preserving shared atomic new-copy import. Raise the synchronized per-list limit to 5,000 after synthetic scale verification; retain independent byte/depth limits |

| D044 | 2026-10-27 | Agreed freeze / deferral | The user verified export and accepted the current M6a behavior. Track persistent per-list collapsed/expanded state separately in M6b as presentation data, independent of file import/export. Storage, synchronization, and temporary search-expansion policy remain open |

| D045 | 2026-10-27 | Agreed | M6b view preferences are database-backed per user/list and shared across devices on the same installation. Keep them separate from content and file transfer. Collapsed-ID storage, independent revision, temporary-expansion policy, and refresh/conflict mechanics remain implementation proposals/design details; real-time push is not implied |

| D046 | 2026-10-27 | Authorized implementation / defaults | Proceed with M6b after user commit/review: additive owned-list view metadata, independent revision, manual per-ID preference queue and bounded conflict rebase; refresh asynchronously on list open and visible window return. Temporary expansion remains local and remote changes preserve active editor visibility. No push sync or offline preference drafts |

| D047 | 2026-10-27 | Authorized implementation / defaults | Proceed with M7 after M6b acceptance: separate literal item notes, modal Apply/Cancel and one undoable commit, 64 KiB limit, ordinary content revision/autosave/recovery and note search. Additive item-column migration and JSON v2 preserve notes; read v1 without notes. Refuse outline-Markdown export containing notes rather than dropping them. Rendering remains M9 |

| D048 | 2026-10-28 | Authorized implementation / defaults | Proceed with M8 after M7 acceptance: exact case-sensitive tag names within owned item data, 12/item and 40 Unicode characters/name, one-command modal edits, single-tag current-list projection with ancestor context, structural locks and explicit reset. Store tags atomically with content, preserve drafts/search, and export JSON v3 while reading v1/v2. Markdown refuses tags rather than dropping them; filter state is not stored as content/view preferences |

| D049 | 2026-10-28 | Authorized implementation / defaults | Begin M9 after user verification and commit of M8. Render an allowlisted Markdown subset without HTML injection or remote image loading; retain original source, JSON v3 and schema. Default item preview can be disabled, links open through separate checked controls, and notes have optional draft preview. These display defaults await user review |

| D050 | 2026-10-28 | Authorized implementation / agreed semantics | Begin M10 after user commit of M9. User chose only a date-only deadline, without scheduled-start date or reminders. Defaults: optional dueDate on items/tasks, local-calendar badges, Apply/Cancel history, retained metadata on conversion, literal date search, additive migration and JSON v4 with older input support; defaults await user review |

| D051 | 2026-10-28 | Requested replan / design direction | Design access before deployment; no public self-registration for now, administrator page preferred for adding friends. Split M11 accounts/sessions, M11a account administration, M11b integration tokens and M11c deployment, preserving M12–M15. Access mechanisms, library choices, activation flow and expiry/rotation defaults in access-control.md remain proposals; no auth implementation or deployment is authorized by this design discussion |

| D052 | 2026-10-28 | Authorized implementation / defaults | User requested M11 after discussing JWT; use server-side browser sessions. Implement password-mode default, explicit existing-owner administrator bootstrap/recovery, request-scoped principal, Argon2id and persistent SQLite-backed sessions with expiry/revocation, CSRF custom-header/origin checks, and draft-safe same-owner reauthentication. Defaults are documented for review; friends/admin UI, personal API tokens and deployment remain M11a/M11b/M11c |

| D053 | 2026-10-29 | Agreed sequence / authorized implementation | Proceed with M11a admin-created friends and access lifecycle, then release-readiness verification and remaining UX polish while Railway/deployment are pending. Defaults: separate /admin, user-role friends only, manual single-use 24-hour activation/reset links, explicit privileged reset invalidation, disable/reactivate and revocation, private content isolation, version-bound digest-only tokens and transactional audit. No public registration, account deletion, role promotion, deployment or commits are included |

| D054 | 2026-10-29 | Authorized release verification / defaults | Proceed after accepted/committed M11a with local backup/restore and release-readiness checks. Native consistent snapshots verify integrity/FKs and migration prefixes; restore publishes a fresh candidate only, applies pending migrations there and retires old sessions/links while changing installation identity. Cached edits must not replay across that identity change. Existing content IDs/owners stay intact; host-specific deployment and UX polish remain separate |

Record material changes to agreed decisions as new decisions referencing those they replace. Do not mark a proposal as agreed without the user's response.
