# M15 — List archives

Authorized 2026-11-03 (D068/D069). Implemented for review; user acceptance and deployment remain pending. See [behavior](../archives.md).

## Implementation

- Additive archive flag migration; owner-scoped, revision-checked Archive/Restore endpoint. Restore retains list order, IDs and content. Existing snapshots and incremental operations cannot change archive status or write archived content.
- Workspace flushes pending content before transitions, blocks unresolved conflicts/drafts/dialogs/filters, replaces successful session baselines and clears old undo/redo. Polling keeps archive metadata and protects dirty local sessions.
- Separate Active/Archive sections on desktop and in the mobile picker. Archived content stays readable with literal notes, links, dates and tags; editing controls and keyboard mutation commands are guarded. Collapse preferences remain independent.
- Search defaults to active content, has Include archived, labels archived hits and opens them read-only. Search context can be cleared without restoring the list.
- JSON v5 adds optional boolean archive state, upgrades v1–v4 and preserves archives through new-copy import. Markdown archived export fails explicitly. Existing portable limits remain shared across both sections.
- Telegram excludes archived Inbox choices and rejects captures while archived, with an actionable response. Restore resumes capture. Physical backup/restore preserves archive metadata.

## Verification

- `make test`: 84 frontend tests and 79 Rust tests passed using disposable databases and the synthetic mock.
- New tests cover strict archive/version validation, ownership, stale and concurrent transitions, snapshot/PATCH guards, original receipt replay, new-copy JSON preservation, archived deletion, backup/restore, Telegram capture rejection/resumption, queued edits and remote dirty conflicts.
- Browser verification: 56 editor tests plus four authenticated and one mock Telegram test passed. After the final search metadata safeguard, all frontend tests and four archive/search browser tests passed again. The local ARM64 review image built and container smoke checks passed (production guards, assets, login, restart persistence and backup/restore); no CI AMD64 publication was run.
- Svelte/TypeScript, formatting, Rust fmt/Clippy and native build passed. No user database, real bot or VPS was modified.

## Manual review

1. Archive a list with tasks, notes, tags and dates. Verify the Archive section, read-only keyboard/mouse behavior, notes/links and collapse state after reload.
2. Search for archived content with and without Include archived, then navigate to a hit and clear search.
3. Export/import JSON and verify the new copies remain archived. Verify Markdown gives an explicit explanation.
4. Restore on desktop/mobile and verify edits and new undo history. Try editing from a second device while the first archives: local changes must remain recoverable.
5. Back up before applying the new image/migration to a deployed installation. Publication and deployment require a separate instruction.
