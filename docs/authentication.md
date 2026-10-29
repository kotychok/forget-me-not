# Authentication and browser sessions — M11

M11 is implemented for local review. M11 supplies no JWT or public registration. M11a now adds the [friend-management UI and activation/reset links](account-administration.md); personal API tokens remain M11b and deployment M11c. The server still binds to loopback and allows only the configured local Host/Origin values.

## First administrator and recovery

Stop an older `make dev` process first. Run from the repository root, using the same FMN_DB_PATH as the application:

```sh
make auth-bootstrap LOGIN=your-login
make dev
```

The command prompts for a password twice without echoing it. It attaches the administrator account to the existing local owner's UUID; list/item IDs and ownership do not change. Bootstrap only succeeds when no accounts exist. There is no default password and no web bootstrap endpoint. A new password-mode installation serves a setup message until this local operation is complete; private APIs require a session even before bootstrap.

For local administrator recovery:

```sh
make auth-reset LOGIN=your-login
```

This requires the existing local owner's administrator login, reactivates that account, changes its password/auth version, revokes its grants and clears sign-in throttle counters. It does not reassign data or create a different owner. Restart after upgrading code/migrations. No running user database was edited during implementation or automated verification.

The underlying binary commands are `--bootstrap-local-admin LOGIN` and `--reset-admin-password LOGIN`. `--password-stdin` is available for controlled non-interactive tooling/tests; never put a real password in shell arguments or a committed script. Normal prompts are preferred.

## Credentials and sessions

Logins are 3–64 ASCII letters/digits/dots/underscores/hyphens, normalized to lowercase; no surrounding whitespace normalization or email requirement. Passwords are preserved exactly, require at least 12 Unicode characters and at most 1,024 UTF-8 bytes, and are stored as salted Argon2id PHC hashes (RustCrypto argon2 0.5.3 defaults: 19 MiB, two iterations, one lane). Hashing runs on blocking workers, with two concurrent HTTP password-hash/verification operations per backend. Hash parameters remain encoded for verification; future tuning/rehashing is separate work.

The browser receives a host-only, HttpOnly, SameSite=Strict `fmn.sid` cookie; no token is stored in localStorage. tower-sessions 0.14.0 manages the random opaque session ID and SQLite session record; axum-login 0.18.0 loads the active account and checks its random auth-version value. Login explicitly cycles the ID even during reauthentication. SQLx store 0.15.0 shares the existing pool; its schema is owned by our additive migration, not an independent auto-migrator.

An application grant binds the session to an owner/auth version and records creation, last use and absolute expiry. Every protected request verifies/touches it, checking account status/version plus 7-day idle and 30-day absolute deadlines. Idle renewal never moves the absolute deadline. No background heartbeat extends idle time; requests and visible-window focus checks count as activity. Session expiry timestamps are server Unix seconds, unrelated to M10 calendar dates.

Account offers session listing, individual revocation, sign out all sessions, and password change. Changing a password verifies the current password and revokes every session including this one. A disabled account is rejected on every request. Future M11a disable/reactivate operations must also rotate auth version and revoke grants transactionally. Requests already authorized before a concurrent revocation may finish; subsequent authorization fails. Expired grant/library rows are cleaned on successful login; no periodic cleanup worker is included.

Sign-in, password-change and M11a access-link attempts share durable limits: 10 attempts per normalized login (or public access-link bucket) and 100 globally per 15-minute fixed window, including successful attempts. Expired buckets are removed before reservation; the global cap bounds unknown-login bucket growth. Account password checks, global rate policy and hash concurrency are enforced server-side. The global limit is conservative for a small private installation and is not a distributed/per-IP production policy. Unknown valid login names do dummy Argon2 verification and receive the same credential error.

## Browser state and expired access

App.svelte is the access gate; WorkspaceApp.svelte retains the editor composition. Initial login is checked before mounting private UI. A 401 from a private API suspends further editor requests and pauses all content queues. Same-owner reauthentication reconciles revisions through existing Autosave.retry, preserving editor history, applied edits and scoped drafts. Conflicts remain explicit rather than being overwritten.

Private API requests carry an expected-owner header captured before sending. It cannot select an owner: middleware compares it with the authenticated principal and rejects mismatches. Thus an old tab cannot replay its content under a different account's cookie. Logout unmounts the Workspace, clears selection/search/UI caches and drops the expected owner; later login creates a fresh Workspace. Durable IndexedDB drafts remain scoped by installation/owner and are not listed for other accounts. Existing local data is not encrypted; shared-device confidentiality is separate scope.

Normal Sign out first flushes content/view changes. If saving fails, it keeps the workspace and reports the failure. Keep drafts and sign out waits for durable applied-content drafts before logout; unsynced collapse preferences may be lost. Storage failure blocks that action rather than claiming drafts are safe. Download local edits is available during expired access and follows existing JSON batch limits.

Open note/tag/date modal drafts are temporarily closed during reauthentication and restored for the same owner. Their text remains in memory and unload warnings stay active. They must be applied or cancelled before signing out; these unapplied drafts are not included in durable content drafts or JSON. Search/import preview dialogs remain transient UI. The editor can resume after a failed credential operation rather than remaining paused.

## HTTP and operating boundaries

Authenticated API mutations require JSON plus the custom `X-FMN-Request: 1` header. Host/Origin checks reject foreign origins (including null), Fetch Metadata rejects cross-site requests, and no CORS permission is emitted. This custom-header/same-origin strategy is the CSRF defense, including login/logout/password operations; SameSite alone is not relied on. Missing Origin is allowed for non-browser tools with the required header and credentials. Auth payloads have an 8 KiB limit; existing content/import limits remain.

Responses are no-store, with no-referrer policy. Only health, auth status/login and static assets are public. Protected routes include content, draft identity, exports/imports, conversion and outline preferences. Resolve a new owner-scoped Store per request; admin role never bypasses content ownership. Auth persistence lives in auth/store.rs; handlers contain no SQL. Credentials/session data are excluded from content JSON.

Password mode is the default. `FMN_AUTH_MODE=local` is an explicit development-only bypass, refused at startup and at request time once any account exists. Isolated legacy editor tests use it with disposable databases; authenticated tests use a separate disposable password-mode installation. There is no automatic fallback to the local identity.

Cookies deliberately have Secure=false for the current HTTP loopback workflow. This is not a deployment configuration: M11c must add verified HTTPS/proxy/origin configuration and Secure cookies (including an appropriate cookie-name/prefix policy). Binding remains loopback; this milestone does not publish a server. Authentication should not be described as a completed production security review.

## Commands and verification

- `make check`, `make test`, `make build` cover both language boundaries.
- `make test-browser` runs the existing local editor regression suite against a disposable DB.
- `make test-browser-auth` bootstraps a synthetic administrator in a separate disposable DB and tests the login gate, session persistence/revocation, password change, draft retention and same-owner recovery. The synthetic credential is test-only; `scripts/dev.mjs --auth` refuses to run without `--test`.

Implementation evidence: [M11 record](plans/m11-authentication.md). Library sources: [axum-login](https://docs.rs/axum-login/0.18.0/axum_login/), [tower-sessions](https://docs.rs/tower-sessions/0.14.0/tower_sessions/), [SQLx session store](https://docs.rs/tower-sessions-sqlx-store/0.15.0/tower_sessions_sqlx_store/), [Argon2](https://docs.rs/argon2/0.5.3/argon2/).

Database restoration through the R1 maintenance command retires browser sessions, grants and pending access links, rotates auth versions and assigns a new installation ID. Password/status state remains that of the snapshot; review restored accounts and use local recovery if needed. Old tabs require reload after preserving local edits; see [Backup and restore](backup-restore.md).

R1 also pins the initialized installation ID in private API request headers. Server-side comparison rejects old-tab payloads even if another tab obtained a new same-owner cookie; normal reauthentication cannot change the pinned scope. Logout/reload initializes a fresh workspace.

## Production transport — M11c

Native local execution keeps its loopback policy and development cookie. FMN_ENV=production selects a container listener and requires one exact FMN_PUBLIC_ORIGIN HTTPS hostname and password authentication. It uses __Host-fmn.sid with Secure, HttpOnly, SameSite=Strict, Path=/ and no Domain. The proxy must preserve the original Host; X-Forwarded-Host/Proto and Forwarded never grant origin or identity trust. Existing CSRF and server-side grant/owner/installation checks remain in force. See [deployment guide](deployment.md); no public deployment has been verified yet.
