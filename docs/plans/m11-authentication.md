# M11 — Authentication implementation record

Authorized by the user after the access-first roadmap discussion and selection of server-side sessions rather than JWT. Implementation defaults await review. M11a friend administration, M11b API credentials and M11c deployment remain separate.

Implemented:

1. Additive authentication/account/grant/throttle/session schema, preserving existing owner/content IDs.
2. Explicit local first-admin bootstrap/recovery with hidden password prompts and no default credential.
3. Argon2id verification/hashing off async workers, durable attempt limits, persistent library-managed cookie sessions, explicit ID rotation, idle/absolute expiry and revocation.
4. Request-local principal and owner-scoped Store across protected APIs; expected-owner guard rejects stale-tab account replay.
5. Login/access gate, account/session controls, password change, same-owner reauthentication and fresh Workspace after logout. Existing editor composition moved unchanged in responsibility to WorkspaceApp.
6. Pause/reconcile autosave, retain durable owner-scoped drafts, support local download and preserve unapplied note/tag/date modal drafts across reauthentication.

Detailed behavior and operating limits: [Authentication](../authentication.md).

Verification:

- `make check` passes with zero Svelte/TypeScript errors or warnings, frontend formatting and Rust fmt/Clippy.
- `make test`: 63 frontend tests and 41 Rust integration tests pass. New checks cover bootstrap ownership, rotation, restart persistence, independent principals, stale-tab owner mismatch, CSRF, revocation, reset/reactivation, account disabling, throttling, expiry and draft-safe pause/logout/reconciliation.
- `make test-browser`: all 49 existing editor scenarios passed after introducing the gate. After the final modal-draft changes, the 8 note/tag/date scenarios passed again.
- `make test-browser-auth`: 3 scenarios pass, covering session/reload/logout, expired credentials with pending text and unapplied modal drafts (including the sign-out guard), and password changes across devices.
- Frontend/backend production builds pass. The account modal was visually inspected at 390px.

Library integration exposed a reauthentication nuance: axum-login's logout does not itself reset its in-memory authentication metadata; explicit session ID cycling is retained and tested to avoid reusing an old cookie on reauthentication.

All data is synthetic/disposable; no user credentials were provisioned and no user database was edited. Native and authenticated browser test servers stopped after their runs. No deployment or commits were performed.
