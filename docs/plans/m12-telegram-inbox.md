# M12 — Telegram Inbox implementation

Authorized 2026-10-30 when the user selected Telegram as the next milestone. Implementation defaults and operation are in [Telegram Inbox](../telegram.md).

Boundaries:

- telegram/mod.rs owns typed updates/configuration; client.rs owns sanitized HTTP transport; worker.rs owns polling and post-commit reply delivery; store.rs owns linking, fresh account checks, cursor/lease/dedup and transactions; routes.rs exposes authenticated settings only.
- store/capture.rs appends through common flatten/save-size rules in the caller's transaction. It never replaces the whole list or bypasses ownership. Content revision advances with deduplication and cursor commit.
- TelegramSettings is a lazy Account section with no access to browser history/draft storage. Its private link is transient and disappears when closed/refreshed or the destination changes. Workspace consumes item links once through existing safe reveal behavior.
- Configuration is optional; browser tests clear inherited bot credentials. No real bot was provisioned or messaged, no image was published, and no VPS operation was performed by the agent.

Verification:

- `make check` and `make build` passed; 71 frontend tests and 65 Rust tests passed (nine Telegram tests plus the existing integration coverage).
- All 53 editor browser scenarios passed, including one-shot item links into collapsed branches. Four existing authenticated scenarios passed. The Telegram settings UI passed in a separate fresh authenticated test server, so password-change/rate-limit fixtures remain independent.
- The local Telegram simulator verifies post-commit delivery, reply retries and cursor dedup without a real bot. Storage tests cover ownership, single-use/expiry/private-chat linking, another account's existing binding, disabled/version-rotated accounts, changing/deleted Inbox, rate/item limits and disconnected restored installations.
- The Docker image built on local linux/arm64 and passed the existing disposable-container startup/login/restart/backup/restore smoke test. GitHub CI will build linux/amd64 on the next version tag; no package has been published by the agent.
- The Account Telegram section was visually inspected at 390px. TypeScript/Svelte reports no errors or warnings; no applied migrations were edited. The older-backup fixture now selects a complete historical prefix rather than accidentally including future migrations.

The user's real-bot acceptance remains outstanding. Enabling the integration requires the reviewed image, updated Compose file and a private bot token on the server; see the operation guide.
