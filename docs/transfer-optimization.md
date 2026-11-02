# Transfer-size optimization — M14

Authorized 2026-11-02 ahead of AI work while real-bot Telegram acceptance remains separate. This first implementation reduces snapshot upload bytes with negotiated gzip; it retains the existing JSON snapshot and revision protocol.

## Measurements and target

The initial [baseline](measurements/m14-baseline.md) measured synthetic text and indent saves at 100, 1,000, 3,000 and 5,000 items before choosing an implementation. Item IDs and suffixes have independent deterministic hashes, with mixed English/Ukrainian text; no private import or production content is used. Gzip reduced the encoded bodies by 70–73%. The implementation target chosen from that baseline was at least 50% fewer upload-body bytes for 1,000+ item text/indent/outdent saves, without changing revision or recovery semantics.

Reproduce the expanded comparison with `make measure-transfer`; [recorded results](measurements/m14-gzip.md) include outdent. Representative results:

| Items | Edit | Plain JSON | Gzip | Reduction |
| --- | --- | ---: | ---: | ---: |
| 1,000 | Text | 151,535 B | 41,888 B | 72.4% |
| 3,000 | Indent | 454,323 B | 124,230 B | 72.7% |
| 5,000 | Outdent | 757,124 B | 206,715 B | 72.7% |

Encode times use performance.now wall time, including stream/buffer setup; they are not CPU profiling or production VPS measurements. The first cold 100-item sample included roughly 28–35 ms initialization overhead; later large-list samples took approximately 2–12 ms on the local development computer. On a hypothetical 1-Mbit/s uplink, the 5,000-item text body alone would take approximately 6.06 seconds plain versus 1.65 seconds gzip, excluding headers/RTT/server work. These are modeled transfer times, not a measured WAN speedup.

A real browser/proxy/disposable-backend check measured a separate random-UUID 1,000-item save at 162,971 JSON bytes versus 46,721 transmitted gzip bytes (71.3% smaller), with roughly 21 ms local HTTP round trip in that run. Timing varies by hardware/load; there is no claim that compression makes loopback requests faster. The browser test gates byte reduction and correctness, not timing.

## Options considered

| Option | Benefit | Decision |
| --- | --- | --- |
| Gzip snapshot upload | Measured ~70–73% saving; same validated JSON and CAS writes | Implemented first |
| Longer coalescing | Fewer requests when typing | Existing 500-ms queue retained; avoid adding editing delay |
| Conditional reads | Helps unchanged downloads | Existing R3 summary polling already fetches full documents only when changed; separate future measurement |
| Patches/operations | Potentially much smaller single-item writes | Deferred: needs a new validation, retry/idempotency and compatibility contract; no such protocol is approved |

This change does not compress every API body or optimize static assets/downloads. Those can be measured separately; no SSE, merging or collaborative editing is added.

## Wire compatibility

GET /api/session now advertises `saveEncoding: "gzip"` alongside existing owner/installation identity. The browser enables compression only after this explicit capability; an older backend without the property continues to receive plain JSON. Clearing/changing the API owner clears the capability. Legacy clients remain valid against the new backend because plain JSON PUT remains supported.

For PUT /api/lists/:id, the browser JSON-stringifies the same {document, baseRevision} snapshot as before. For UTF-8 bodies at least 8 KiB, it tries the browser's native CompressionStream('gzip'); it sends Content-Encoding: gzip only if the result is at least 20% smaller. Small bodies, unavailable encoders, unhelpful compression and local encoding failures use the original JSON. No HTTP request has been sent when this local fallback occurs. There is no automatic resend after a rejected, timed-out or uncertain HTTP write.

Server middleware on the snapshot PUT route accepts gzip, bounds the wire body to 1 MiB, then streams decompression into the existing 1-MiB JSON extraction limit. Unsupported encodings return 415, oversized wire or decoded bodies return 413, and malformed compressed data fails without a write. Host/Origin, CSRF, authentication and owner/installation checks remain in force. Other routes keep their existing limits and encoding behavior.

No new database migration or portable JSON schema is added by M14. Deploy client/server together in the normal image; after a rollback, reload the browser to negotiate against the selected server. Outstanding old requests are still subject to owner/installation/revision guards.

## Retry, drafts and identity

Autosave still retains the original uncompressed attempt document and generation. A response acknowledges that attempt only; later edits stay dirty. After a lost reply, retry reads the server snapshot and uses semantic equality to recognize an already-committed write, avoiding a duplicate revision increment. Conflicts preserve local edits and existing draft/new-copy recovery. Browser draft storage and undo never store gzip blobs.

Compression is asynchronous. The request captures owner/installation headers before preparing bytes and checks the identity epoch again before sending. Switching accounts, including away and back during encoding, cancels the prepared write rather than retagging it with another session. An identity response from an earlier account epoch cannot configure the current workspace. Same-owner installation pinning remains unchanged.

## Verification

Coverage includes UTF-8 round trips, small/unsupported/failing encoder fallback, old-server capability fallback, account changes during compression, no automatic resend, compressed/plain CAS compatibility, malformed/unsupported/oversized bodies and auth/CSRF gates. Browser verification checks actual gzip upload bytes, saved Unicode content, reload, and a committed gzip write whose response is deliberately lost: retry acknowledges it without another PUT. Full regression and container results are recorded in [M14 implementation](plans/m14-transfer-optimization.md).

Sources: [tower-http request decompression](https://docs.rs/tower-http/0.6.11/tower_http/decompression/struct.RequestDecompressionLayer.html) and [Axum body limits](https://docs.rs/axum/0.8.9/axum/extract/struct.DefaultBodyLimit.html) describe the middleware and decoded JSON extraction behavior; local tests verify the combined ordering and limits.
