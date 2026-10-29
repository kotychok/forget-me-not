# M11a — Administrator-managed friends

Authorized 2026-10-29. Agreed sequence: M11a, release-readiness verification, remaining UI polish; deployment waits independently.

Implementation defaults: separate /admin page, friend creation without public registration, manual delivery of single-use 24-hour activation/reset links, disable/reactivate, session revocation and local admin recovery. Administrator role does not bypass content ownership. No account deletion or role-promotion UI.

Use a 256-bit OS-generated secret and store only SHA-256 digest plus owner/purpose/expiry/version. Public activation uses fragment-carried tokens, removes the fragment from history, previews through POST without consuming, and atomically redeems with password setting and session invalidation. Reissue/disable/version changes invalidate old links. Admin-issued reset explicitly retires old credentials and sessions until redemption; the UI explains that consequence.

Add migrations, backend transaction/security tests, authenticated browser workflows and responsive styling. Tests use synthetic/disposable data only. No deployment or commits.


Implemented and verified for local review:

- `make check`: zero Svelte/TypeScript errors/warnings; frontend formatting, Rust fmt/Clippy pass.
- `make test`: 63 frontend and 47 Rust integration tests pass. Six account tests cover digest/secret boundaries, single-use and concurrent redemption, stale/reissued/expired/blocked links, invalid-password non-consumption, reset/enable semantics, authorization, transactional rollback, concurrent admin protection and upgrade from a seeded M11 database preserving credentials, content and grants.
- `make test-browser-auth`: all 4 scenarios pass, including the new two-context account lifecycle and private-content isolation test.
- `make test-browser`: all 49 prior editor scenarios pass. Frontend/backend builds pass.
- Administration was visually inspected at desktop and 390px mobile widths. Opening a replacement fragment link in the same tab caught and fixed the need for a hashchange handler with stale-response guards.

Detailed operating contract: [Account administration](../account-administration.md). Restart the backend for the additive migration; do not bootstrap existing credentials again. All tests use synthetic/disposable data; no real friends or credentials were created, no messages were sent, no hosting was modified, and no commits were made.

Next agreed work remains a release-readiness pass, especially verified backup restoration and remaining UI/error/empty-state polish. That broader pass is not marked complete by these milestone checks.
