# R1 — Local first-release readiness

Authorized after the user accepted and committed M11a on 2026-10-29. Scope: backup restoration, upgrade, sessions/drafts and isolation verification before later UX polish/deployment.

Implemented:

- Native db-backup, db-verify and fresh-path db-restore commands, using a verified SQLite snapshot with exclusive durable publication.
- Candidate-only migration of supported older snapshots, source/target collision protection and source verification without provisioning/migrations.
- Restored installations retire session grants/cookies/access links and change installation identity, preserving content/owner IDs.
- Same-owner reauthentication now checks installation identity before replaying autosave queues; mismatched installations keep old edits paused and downloadable.

Verification:

- `make check` passes with zero Svelte/TypeScript warnings/errors and Rust fmt/Clippy checks.
- `make test`: 65 frontend tests and 52 Rust integration tests pass. Five maintenance scenarios cover live WAL content/view/credential restoration, stale-cookie/link retirement, concurrent snapshots, older-snapshot upgrade, invalid/colliding targets and a CLI that never initializes its configured source during verification.
- A model test rejects queued edits after an installation change even with equal owner/revision; a transport test proves a new same-owner cookie cannot retag old requests. Server tests reject the old installation header even with a valid newly issued cookie.
- A disposable CLI drill ran db-backup/db-verify/db-restore through Make with an apostrophe/space-containing path.
- `make test-browser-auth` passes all 4 authenticated workflows; `make test-browser` passes all 49 editor workflows after the final scope-header changes. Production frontend/backend builds pass.

No schema migration is needed; all published migrations remain unchanged. No user database or credentials were modified; no user dev process was stopped and no commits were made.

 All checks use synthetic/disposable databases. Actual installation backup location/retention, off-host storage, HTTPS/proxy configuration and an operator drill on the selected host remain deployment decisions. Local verification is not a claim that public deployment is complete.
