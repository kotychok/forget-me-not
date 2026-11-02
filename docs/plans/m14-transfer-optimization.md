# M14 — Measured snapshot upload reduction

Authorized 2026-11-02. The user selected M14 before further integration/AI work. M12 remains implemented with real-bot acceptance separate.

Baseline and target were recorded before implementing compression: >=50% upload-body reduction for representative 1,000+ item text and tree-move snapshots. Synthetic gzip measurements reached ~70–73%, so choose negotiated compression while retaining snapshot validation, CAS, retries and drafts. See [protocol and measurements](../transfer-optimization.md).

Implementation boundaries: save-encoding.ts handles local byte preparation; api.ts negotiates capability and pins identity across the await; Autosave/Editor are unchanged. Snapshot PUT middleware bounds wire bytes and decoded JSON before Store runs the existing transaction. No migrations, new save operation API or portable format changes are added.

Verification:

- `make check` and `make build` passed. All 74 frontend tests and 67 Rust tests passed, including the loopback-only Telegram simulator and the new compression transport tests.
- All 54 editor browser scenarios, four authenticated scenarios and the isolated Telegram UI scenario passed (59 distinct browser scenarios). The gzip browser test measured 162,971 raw JSON bytes versus 46,680 wire-body bytes in the full run, with approximately 18 ms local HTTP time; results vary with generated IDs/load.
- A committed compressed write whose response was deliberately lost was reconciled by GET without another PUT or revision increment. Existing draft recovery, multi-device refresh and history tests remained green.
- Wire-size and decoded-size oversize requests both return 413. Malformed/unsupported encodings do not mutate data; missing authentication and CSRF are still rejected.
- The final Docker image built locally on linux/arm64 and passed disposable-container login/restart/backup/restore smoke checks. GitHub's linux/amd64 build and deployment/user acceptance remain pending the next tag; no image was published and no VPS was changed by the agent.
- Source/measurement docs have valid local links and `git diff --check` passed. No database schema or portable format change is included in M14.

The >=50% synthetic byte-reduction target is met for text, indent and outdent at 1,000–5,000 items (~72–73%). Production WAN performance is not measured. After deploying, reload the browser, edit a large list and verify successful saves/reloads, including a second-device revision conflict if convenient.
