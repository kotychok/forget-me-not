# M14b — Incremental save implementation

Implemented for review on 2026-11-02 after explicit authorization (D067). User acceptance and deployment are pending.

## Behavior and boundaries

- A pure planner compares the acknowledged full document with the frozen next document. Sparse text/metadata edits and branch-root moves/removals become ordered version-1 operations.
- The API negotiates capability, compares actual encoded sizes and selects PATCH or the existing snapshot PUT before sending. Old servers continue to receive snapshots. Gzip remains available for worthwhile larger bodies.
- Autosave retains full local documents and a frozen identity-scoped wire attempt. A lost PATCH response retries the identical operation ID/body; the original acknowledgement advances only that attempt's baseline. Newer edits stay dirty. Receipt expiry triggers snapshot reconciliation; unresolved differences retain conflict recovery.
- Rust validates and applies the batch to an owned tree, then commits the shared row diff, list revision and digest receipt in one SQLite transaction. List-wide CAS prevents automatic merging.
- Migration `20261102001000_incremental_save_receipts.sql` adds bounded receipts: 24 hours and latest 10,000 per owner. Startup/hourly maintenance and successful writes prune expiration. Restore clears receipts and rotates installation identity.
- JSON/Markdown formats, editor history, full local drafts and independent collapse metadata remain unchanged.

## Verification

- Frontend: 81 tests, including independent planner interpretation, randomized editor changes, deletion/rescue efficiency, frozen retries with newer local/remote edits, expired receipts, capability selection and identity pinning.
- Rust: the full 73-test suite passed, followed by all seven incremental integration tests after adding work/result bounds coverage. New tests cover strict decoding/canonical hashes, transactional rollback, concurrent duplicate/different packets, receipt expiry/eviction/restore, and gzip/auth/owner/installation guards. The receipt transaction was subsequently refactored into a concrete helper and its integration tests rerun successfully.
- `make check` passed (Svelte/TypeScript, formatting, Rust fmt and Clippy). The final native production build passed.
- All 55 editor browser tests plus four authenticated tests and one mock Telegram browser test passed. The local ARM64 review image built successfully and its container smoke test passed (production guards, assets, login, restart persistence, backup/restore). CI AMD64 publication was not run. All tests use disposable data; no user database, bot or VPS is modified.

## Synthetic transfer measurements

Run `make measure-incremental` on Node.js 22.13+ with native TypeScript stripping. Synthetic text edits and branch moves at 1,000/3,000/5,000 items used 228–233 bytes versus approximately 42/127/211 kB gzip snapshots: 99.5–99.9% fewer body bytes, exceeding the >=90% target. Planner time in this run was approximately 2–6 ms. These are local synthetic measurements, not mobile/VPS latency guarantees. Both complete payload candidates are encoded for comparison, so encoding CPU and local full-snapshot memory remain costs.

## Manual review

1. On a large list edit text, change notes/tags/date, indent/outdent, move/delete branches and undo/redo; reload and verify content.
2. In DevTools confirm small changes use PATCH; old-capability servers and cheaper full replacements still use PUT.
3. Interrupt a response after commit and retry; verify no duplicate items/revision increment. With a second device editing concurrently, verify conflict choices preserve local edits.
4. Back up before upgrading the deployed application. The additive migration runs through the existing migration mechanism. Publish/deploy only under a separate user instruction.
