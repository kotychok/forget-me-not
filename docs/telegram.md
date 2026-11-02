# Telegram Inbox — M12

Authorized 2026-10-30. Optional capture through a dedicated Telegram bot; no LLM, public registration or personal API tokens are required. The Rust process uses long polling, so no webhook or extra public port is added. Disabled unless FMN_TELEGRAM_BOT_TOKEN is configured; all existing browser functionality remains available without it.

## User behavior

1. Create a normal list to use as your Inbox (or choose an existing owned list).
2. Open Account → Telegram Inbox, choose the list, and generate a connection link.
3. Open the private link in your own Telegram account and press Start. It expires after 10 minutes, works once, and must not be shared. Issuing another link revokes the previous one.
4. Refresh Telegram settings in Account to confirm the connection. Each private text message or URL becomes one plain root item at the end of that list. Line breaks and original text remain literal; hidden text-link destinations are appended on separate lines so they are not silently lost.
5. Use Apply Inbox to change the destination. Disconnect Telegram in Account, or send /disconnect to the bot, to remove the connection. /start without a payload and /help explain setup. These exact commands are reserved; other text is captured literally.

Only private chats from human senders whose user ID matches the private chat ID are accepted. Groups, channels, bot senders and edited-message updates are ignored. Attachments, media captions, voice, formatting conversion and tree editing are not included; unsupported private messages receive an explanation rather than being silently imported. A deleted Inbox stops captures until another owned list is selected. Limits are 30 incoming private messages per sender per minute, existing 5,000-item/32-KiB-text limits and the list save-size budget. A rate-limit warning is sent once per minute; over-limit messages are not captured. Users should resend after the warning interval.

Successful captures reply with a list/item link after the database commit. The app opens that owned list and temporarily reveals/focuses the item, then removes the consumed item URL parameter. Reload/list switching does not replay the jump. Incoming items increment the ordinary content revision: clean browser sessions refresh through R3; unsaved browser changes retain their existing conflict/new-copy recovery behavior. Telegram never overwrites a browser's local draft.

## Enable on the VPS

Create a dedicated bot using the official [BotFather](https://t.me/BotFather) /newbot flow. Keep its token private; do not paste it into chat, Git, command arguments, screenshots or logs. Reuse of a bot already serving another application is not supported.

After reviewing/committing M12, publish a new version-tag image through CI. Create and verify a pre-upgrade database backup. Copy the updated deploy/compose.yaml to the VPS, retaining the existing private .env. Set its new FMN_IMAGE digest and add this variable using a text editor:

```dotenv
FMN_TELEGRAM_BOT_TOKEN=YOUR_PRIVATE_BOT_TOKEN
```

This is a placeholder, not a usable credential. The tracked .env.example keeps the value empty. Do not overwrite the VPS .env with the example file. Then, in the app deployment directory:

```sh
sudo docker compose config --quiet
sudo docker compose pull
sudo docker compose up -d --wait
sudo docker compose logs --tail=100 app
```

Startup checks the token through getMe, obtains the bot ID/username and checks that no webhook is configured. Errors are sanitized. An existing webhook causes startup failure; disable it deliberately through the Telegram API before using this bot here, rather than automatically deleting another deployment's webhook. Outbound HTTPS to api.telegram.org is required. Caddy configuration and inbound firewall ports do not change. FMN_PUBLIC_ORIGIN supplies confirmation links; do not put a bot token into Caddy.

Use one application replica. A database lease also prevents two processes sharing this database from committing captures as competing pollers. After an ungraceful stop, lease takeover may take up to 90 seconds. Graceful shutdown releases it. Changing/rotating bot credentials requires recreating the app container. Connections are scoped by bot ID; replacing the bot requires reconnecting users.

Native password-mode development can use the same worker through its process environment; confirmation URLs use the loopback backend port. Run make build before following native confirmation links so the backend has frontend assets to serve. Local bypass mode cannot enable Telegram. Disposable browser runners explicitly clear the bot token, even if the parent shell has one. Automated tests must use the local mock, never a real bot.

## Security and persistence

The browser uses existing authenticated, CSRF-protected owner/installation-scoped routes: GET/DELETE /api/telegram, POST /api/telegram/link, PATCH /api/telegram/inbox. No client-provided owner ID or API bearer token is trusted. Bot credentials never appear in these responses; only bot username, connection ID, selected list and the once-issued connection URL are returned.

Connection payloads contain 256 random OS-generated bits encoded as 64 hex characters. Only their SHA-256 digests are stored, along with bot, owner, destination, expiry and current authentication version. Redemption is serialized and single-use. An already-linked Telegram identity cannot be taken by another app account without /disconnect first. Account disabling is checked on every capture; password/version changes invalidate both old links and connections. Reconnecting is deliberate. Security changes are audited without tokens, chat text or private content.

The additive migration stores links, connections, poller leases/cursors, short-lived rate counters and pending generic reply receipts. Telegram metadata is absent from JSON/Markdown content exports. Captured items themselves are ordinary content and export normally. SQLite backups include integration metadata, but restoration removes all connections, pending links and replies and clears leases. Users must reconnect afterward. Never enable the live bot token on a temporary restore/test installation; separate databases cannot coordinate a single bot's polling lease.

## Delivery and failure semantics

Within a write transaction, the worker verifies its lease and durable cursor, checks current account/destination ownership, validates and appends the item through Store, increments the content revision, creates a reply receipt and advances the cursor. Storage failures roll the transaction back, so no successful acknowledgement precedes a commit. Duplicate update IDs already covered by the cursor cannot append twice, including after process restart. A stale browser snapshot cannot remove the capture because the revision changed.

Replies are sent only after commit, with link previews disabled and without echoing message contents. Failed replies retry separately with bounded attempts (at most eight, 60-second retry delay or Telegram’s retry_after interval, one-day retention). Pending account-bound replies recheck the current connection/account before sending; an already in-flight Telegram delivery cannot be recalled. Lost responses can produce duplicate confirmation messages, but do not reappend content. Reply delivery is best effort; repeated Telegram errors do not undo a committed item. Telegram's own update retention is limited, so long outages are not an unlimited delivery guarantee.

The worker requests only message updates and commits them in order. Temporary HTTP/poll failures retry after 10 seconds (or the supplied Telegram retry_after interval) with a sanitized log message. Neither credential-bearing HTTP URLs nor incoming Telegram payloads are logged. Status in Account means configured/linked, not a guarantee that Telegram networking is currently healthy. This first implementation does not add an operator dashboard, webhook endpoint, message archive, AI or Telegram reminders.

## Acceptance

Automated verification uses synthetic accounts, temporary SQLite databases, a loopback-only Telegram API simulator and browser request interception. Real bot setup/capture remains a user deployment check: connect your own Telegram, capture text and a link, see R3 refresh, change Inbox, disconnect, confirm no new capture, then reconnect. Test concurrent browser edits through normal conflict recovery, and confirm a restored test database has no Telegram connection (without enabling the production bot token there).

Sources: [Telegram getUpdates](https://core.telegram.org/bots/api#getupdates) defines offset confirmation, long polling and webhook exclusion; [deep linking](https://core.telegram.org/bots/features#deep-linking) defines /start payloads and their 64-character limit. Transport uses the pinned [reqwest client](https://docs.rs/reqwest/0.13.5/reqwest/) with TLS verification, bounded responses/timeouts and no redirects.
