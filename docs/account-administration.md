# Administrator-managed accounts — M11a

Implemented for review, 2026-10-29. An administrator opens **Manage people** in the sidebar or `/admin`. No public registration, email provider, account deletion or role-promotion UI is provided. Newly created friends always have the user role; administrator privileges do not grant access to their lists.

## Friend access

Enter a display name (1–100 Unicode characters, no controls) and a login following M11's lowercase ASCII normalization/rules. Creation atomically inserts the user, inactive credentials and an activation token. Duplicate logins fail without orphan user rows. A pending friend cannot sign in.

The dialog shows an access link once, with Copy link and a manual-selection fallback. Deliver it privately yourself; the application sends no messages. Closing the dialog clears its displayed secret; account listings cannot recover it. A new activation link invalidates earlier ones. Validity is 24 hours from issuance.

The recipient opens `/activate#token=...`, chooses and repeats their own password, then signs in normally. No automatic login is performed and no existing browser account is replaced. Password policy is shared with M11. Preview does not consume the link; redemption is one transaction that sets credentials, marks consumption and invalidates old access. Refreshing after the fragment is removed loses the in-memory token; reopen the original delivered link. Opening a different link in the same tab reloads its state with stale-response guards.

## Account controls

- **Disable account** blocks login, rotates the authentication version, revokes grants and outstanding links, and preserves all lists/content.
- **Enable account** allows fresh login only when a usable password exists. Pending activation/reset still requires a newly issued link; old sessions and old links never return.
- **New activation link** reissues access for an unactivated account.
- **Reset password** is an explicit privileged recovery action: after confirmation, the old password is retired, login is disabled and all sessions/old links are revoked immediately. Only using the new link restores password login. This differs from a public self-service reset request; no anonymous caller can trigger it.
- **Revoke sessions** revokes current grants and outstanding links, while retaining a usable password if one exists. An active user can sign in again. Pending users may need a new link.

You cannot disable/reset/revoke your own administrator account from this page; use Account or the local recovery command. Authority is rechecked inside mutation transactions, and concurrent administrator actions cannot remove the last active administrator. Role promotion is not offered in this milestone. M11's explicit local `make auth-reset LOGIN=...` remains available and reactivates the existing local administrator without reassigning data.

Account cards show active-session counts and the expiry of any outstanding current link. They never expose passwords, token digests or retrievable token secrets. The UI supports narrow screens. Back to lists returns to the retained editor session; entering administration flushes/pauses that owner's editor queues. Pending modal drafts must be applied/cancelled first. Expired administrator requests trigger the same-owner reauthentication gate.

## Token/security boundaries

A token contains a public UUID identifier and 32 bytes of OS-generated randomness encoded as hex. Only a SHA-256 digest of the full token is stored, with user, purpose, auth version, expiry, consumption and revocation metadata. Verification uses constant-time digest comparison. Purpose/credential state, account blocking and version are checked before hashing a password and again under the redemption transaction's write lock. Two concurrent uses can commit only one password. Invalid password input does not consume a valid link.

The secret travels in a URL fragment, not a query/path, and is removed from browser history before preview. Preview/redemption use POST JSON, same-origin/custom-header checks, no-store/no-referrer policy and bounded attempts. GET never consumes a credential, including link-scanner visits. The shared M11 attempt policy also covers public link checks/redemptions, with a per-link bucket and global cap. Secrets are not persisted in frontend storage, printed to logs, included in account listings or exported in content JSON.

No automatic credential submission retry is performed. If a response is lost after password setting, try normal login with the chosen password before asking for another link. Expiry/revocation still apply even after a successful preview. A server-authorized mutation already in flight before revocation may finish, as described in M11.

The `account_audit` table records successful web account creation, link issue/redemption, disable/enable and administrator revocation with actor/target/action/time, never credentials or private content. It is not yet a complete operator-facing audit console for all legacy M11 CLI/session operations.

## Persistence and modules

The additive `20261029000800_account_administration.sql` migration adds activation/admin-blocking metadata to existing accounts, backfills existing credentials as activated, and adds `account_tokens` and `account_audit`. Existing owner IDs, credentials, content and valid M11 grants survive upgrade. User creation timestamps retain the existing millisecond convention; security token/audit timestamps use Unix seconds.

`accounts/mod.rs` holds model/token primitives, `accounts/store.rs` owns SQL and lifecycle transactions, and `accounts/routes.rs` maps HTTP and checks admin routes. Auth middleware still supplies the request principal. `AdminPage` owns UI/temporary issued links; `ActivationPage` owns the public fragment flow; `lib/accounts.ts` is transport. Editor/content code is unchanged. JSON remains v4 and excludes access metadata. Installation backups include account/security tables.

Run `make check`, `make test`, `make test-browser-auth` and `make test-browser` using disposable data. The [M11a record](plans/m11a-account-administration.md) records verification. Restart `make dev` after upgrading to apply the embedded migration; do not bootstrap the administrator again.

Design references: [OWASP password recovery guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html) supports random, expiring, single-use tokens and ordinary login after redemption. This implementation uses administrator-issued recovery with explicit credential invalidation, not anonymous self-service lockout. Production HTTPS/proxy configuration, delivery/recovery operations and backup restoration remain M11c/release-readiness work; Railway is not configured by M11a.
