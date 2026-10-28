# Access control — roadmap and design

Updated: 2026-10-28. The user requested access design before deployment, no public self-registration for now, and an administration page for adding friends. The user subsequently authorized M11 implementation and chose server-side sessions over JWT. Its implemented defaults are recorded in [Authentication](authentication.md); the remaining administration/integration/deployment details below remain proposals. M10 assignment/display was checked by the user; its remaining acceptance is unchanged.

## Proposed delivery order

1. M11: identity, login/logout, password changes, persistent browser sessions and owner isolation.
2. M11a: administrator account management and invitation/activation/reset lifecycle.
3. M11b: scoped personal API tokens, if required for integrations; independent of browser login and not a deployment prerequisite.
4. M11c: deployment, HTTPS, operational configuration, backup/restore, after M11 and M11a acceptance and a hosting decision.

Keep M12–M15 numbers. Telegram requires protected access/deployment (M11c); whether it needs personal API tokens is a separate design decision. The bot's Telegram secret is not a user's application token.

## Accounts and ownership

Keep existing UUID user IDs and users → lists → items ownership. Propose a unique normalized login identifier, display name, admin/user role, pending/active/disabled status and a credential/session invalidation version. Exact login naming and normalization remain open; email is not required. Private lists stay private: administrator role permits account operations, not implicit access to everyone's lists, exports or drafts. Sharing remains separate scope.

The existing Store embeds one fixed local owner in application state. Authenticated requests must instead resolve a validated principal at the HTTP boundary and construct an owner-scoped Store/context for that request, sharing the SQLite pool. Never mutate a global owner or trust an owner ID from a request/header. Background work must receive an explicit validated owner. Check authenticated identity, account status and required role/scope on every protected path, including search/export/import/conversion/view state.

First administrator creation must be an explicit local CLI/bootstrap operation. Bind credentials to the existing local user's UUID after explicit selection so current lists retain ownership. No public first-visitor takeover, default password or authenticated-mode fallback to the local identity. Keep any local development bypass explicit, loopback-only and incompatible with deployment mode. Preserve the last active administrator; define a local recovery command before rollout.

## Browser sessions (proposed)

Use a random opaque session identifier in an HttpOnly cookie; session state lives server-side in SQLite. No browser localStorage bearer token and no JWT access/refresh pair is needed for this single application. Use Secure cookies under HTTPS, a deliberate SameSite policy, CSRF protection for cookie-authenticated mutations, origin validation, and rate/concurrency limits on credential endpoints. These controls also apply to admin and activation endpoints; SameSite alone is not the full CSRF design.

On successful login, rotate the session ID. Renew idle expiry on activity subject to an absolute lifetime; renewal does not grant a fresh unlimited lifetime. Proposed starting policy: 7-day idle expiry and 30-day absolute lifetime, still to agree. Persist created/authenticated-at separately so idle renewal cannot erase the absolute deadline. List current sessions with creation/last-use/expiry, revoke one or all, logout, and expire old rows. IP/device descriptions are display hints, never authentication factors.

Password changes/admin resets revoke existing sessions, using an auth version/hash and explicit policy for the session initiating the change. Disabled users cannot keep using old cookies. Enforce expiry and revocation server-side, including concurrent requests; define which already-authorized in-flight writes may finish. Do not claim library defaults supply all these policies.

Expired login pauses autosave and offers reauthentication without destroying unsaved content. Reauthentication as the same owner can resume after revision reconciliation. Account switching replaces Workspace/caches/view state/search and never submits the previous owner's drafts as the next user. Durable drafts stay scoped to installation/owner, and are not listed for other users. Logout must handle pending edits explicitly rather than silently discard them. Local-device confidentiality/encryption of retained drafts is a separate design question.

## Admin-created accounts (proposed)

Admin creates a pending user with login and display name. Generate a random, single-use activation secret, expose its link once for manual delivery, and store only its digest plus user, purpose, expiry and consumption state. The invited user chooses their own password. This is activation of an already-created account, not public self-registration; no SMTP integration is needed initially.

Redeem activation/reset secrets atomically with password setting and account activation/invalidation. Reissuing revokes earlier outstanding secrets; expired, consumed or wrong-purpose secrets fail. Prevent two simultaneous redemptions. Proposed expiry: 24 hours, to agree. Avoid URLs containing secrets in logs/referrers; finalize link consumption and history-clearing behavior during implementation. Ordinary GET must not consume a secret (link scanners may visit it).

Admin can list/create/disable/reactivate accounts, reissue activation/reset links and revoke sessions. Reset must not reveal a stored password. Begin with disable rather than destructive account deletion. Audit account/security changes without recording credentials, tokens or private list content. Role changes and revocation need server-side checks, not only hidden UI buttons.

## Personal API tokens (M11b proposal)

Use separate random opaque bearer credentials for explicit integrations, not browser login. Propose a public lookup prefix/ID plus at least 256 random secret bits from the OS CSPRNG. Show the complete secret once; store a cryptographic digest, owner, name, scopes, creation/expiry/revocation/last-use metadata. Passwords use a slow password KDF; uniformly random token secrets can use a cryptographic digest with constant-time verification. Never log Authorization headers or include tokens in ordinary content JSON exports.

A token cannot exceed its owner's permissions, manage accounts or mint more credentials by default. Start with narrowly defined scopes (for example Inbox append rather than unrestricted list writes). Require explicit expiry policy and enforce account disabling/revocation for every request. Rotation creates a new token, optionally with a bounded explicit overlap window, then revokes the old one; expiry does not auto-renew a stolen token. Do not introduce refresh tokens unless an actual delegated client requires them. Supporting bearer credentials creates no requirement for the browser to use them.

## Data/module sketch

| Responsibility | Proposed persistent data |
| --- | --- |
| Account | Existing users, additive role/status/login/auth-version fields |
| Password | One per-user PHC-encoded Argon2id hash; timestamps |
| Browser sessions | Library-managed session records plus explicit owner/session lifecycle metadata where needed |
| Activation/reset | Digest, user, purpose, expires/consumed/revoked timestamps |
| API credentials | Separate token digest, owner, scopes and lifecycle metadata |
| Audit | Actor, account/security action, target, time and outcome; no secrets |

Proposed modules: `auth/` for password/session/principal middleware, `accounts/` for account lifecycle, `tokens/` for purpose-specific credentials, and small owner-scoped persistence modules. Handlers do not embed SQL; editor modules do not know about authentication. Prefer concrete modules to a generic auth/plugin framework. Add migrations; never edit applied SQL. Choose schema details after library compatibility verification.

## Rust components evaluated

- [axum-login](https://docs.rs/axum-login/latest/axum_login/) provides authentication/authorization middleware and extensible user/backend traits. It uses tower-sessions. This is a candidate, not yet a dependency.
- [tower-sessions](https://docs.rs/tower-sessions/latest/tower_sessions/) manages opaque-cookie-backed server sessions and expiry. [Session stores](https://docs.rs/tower-sessions/latest/tower_sessions/index.html#session-stores) include SQLx/SQLite support through tower-sessions-sqlx-store. Confirm the exact compatible Axum/SQLx/session versions before adding packages; integrate any library schema with our versioned migration policy.
- [axum-login session implementation](https://docs.rs/axum-login/latest/src/axum_login/session.rs.html) rotates IDs at initial login and checks the user's authentication hash when loading a session. Application account status, role, absolute lifetime, recovery and revocation policy remain our responsibility.
- [RustCrypto argon2](https://docs.rs/argon2/latest/argon2/) supports Argon2id and PHC password hash strings. Choose parameters against measured host resources and bound concurrent hashing; do hashing off asynchronous request workers.

These are building blocks, not a ready admin portal. A separate identity server/OIDC remains a possible future option if external login/MFA/SSO becomes necessary; it is not required by the current small private installation.

## Acceptance before deployment

Verify two users cannot cross-read/write any list/metadata/export/draft; administrator role does not bypass content ownership; invalid/expired/revoked cookies and tokens fail; passwords are never stored literally; session fixation, CSRF, login throttling, activation replay/concurrency and reset invalidation are covered. Verify same-owner reauthentication with pending edits, account switching, migrations preserving existing ownership, restart persistence and local admin recovery. Deployment also verifies HTTPS/proxy trust and restoration of account/session secrets/state. Details and dependency versions remain proposals pending implementation design.
