# Incremental saves — M14b protocol proposal

Draft for discussion, 2026-11-02. The user authorized agreeing the design, not implementing this protocol. M14 gzip snapshots remain the implemented behavior. Only the explicitly agreed rules below are accepted; the remaining protocol choices are proposals.

## Agreed rules — 2026-11-02

- Removing an item removes its whole currently attached branch, consistent with existing editor deletion. Preserving a descendant requires moving it out before deleting its ancestor.
- Keep list-wide revision conflicts. Stale concurrent writes are not automatically merged, even when they touch different items.
- Each batch has a unique operationId. Retrying the same committed packet returns its prior acknowledgement; a known ID reused with different content is rejected.
- Retain receipts for 24 hours and at most the latest 10,000 per owner, whichever bound removes a receipt first. After expiry/eviction, original base-revision checks and snapshot reconciliation still prevent duplicate application. Receipts contain hashes/results, not copies of item text.

- Omitted fields stay unchanged. Empty note strings/tag arrays clear those fields; dueDate:null clears the deadline.
- Structural placement uses parentId and afterId sibling anchors. parentId:null means root level; afterId:null means first in that sibling group.
- Compute each batch against the last acknowledged baseline. Edits made while a request is in flight remain pending for the next batch.
- Select snapshot transport before sending when a batch would be larger. An uncertain PATCH response never triggers a blind snapshot fallback; reconcile first.

The core behavioral rules are agreed. The exact versioned endpoint/envelope, canonical hash representation, validation/error table and limits below still need a technical specification; implementation has not been requested yet.

## Proposed contract

Keep a complete local tree and a complete last-acknowledged baseline. Compute each outgoing batch from that baseline to a frozen target snapshot; do not upload the keypress/undo log. One per-list request remains in flight at a time. Later edits remain local until the acknowledgement establishes a new baseline.

Use PATCH /api/lists/:id with an explicit protocol version, UUIDv4 operation ID and base revision:

```json
{
  "protocolVersion": 1,
  "operationId": "90de58d3-9654-4c25-a34f-10fbaf3d872f",
  "baseRevision": 12,
  "ops": [
    {"type": "update", "itemId": "B", "changes": {"text": "Updated thought"}},
    {"type": "move", "itemId": "B", "parentId": "A", "afterId": null}
  ]
}
```

A/B are explanatory placeholders; actual item IDs must remain canonical UUIDv4 values. This batch edits B and makes it A's first child. Its descendants stay attached and need not be transmitted. A successful new batch returns operationId and revision 13; replay of the same committed batch returns the original acknowledgement, even if the list has since advanced further.

## Operations

| Operation | Proposed meaning |
| --- | --- |
| update | Change only named item fields: text, note, tags, dueDate, kind, completed. Missing fields stay unchanged; empty string/array clears note/tags, dueDate:null clears the deadline. Type/completion changes must produce a valid combination. |
| create | Add one client-ID item with its fields, parentId and afterId. No embedded unchanged descendants; new parents/preceding siblings must already exist when referenced. |
| move | Reattach the whole branch rooted at itemId under parentId, immediately after sibling afterId. parentId:null means root; afterId:null means first. The anchor must be in the destination sibling group; cycles, self-parent and self-anchor are invalid. |
| remove | Delete the item and the descendants still attached at this point in the batch. A child to preserve must be moved out before removing its ancestor. |

An optional top-level title updates the list title; omission preserves it. It follows the existing non-empty/length rules. Note/text values are whole changed fields, not character-level text diffs.

Operations apply in order. The client planner simulates the batch against its baseline, creates parents before children, places target nodes in a safe order, and removes obsolete branches after surviving descendants have been moved. It checks that the simulated result equals the frozen target. The server validates ownership and references, rejects cycles during structural operations and validates the complete final tree. Intermediate type/completion field changes may be checked at final validation; no intermediate state is committed.

Use sibling IDs on the wire, keeping the existing integer positions in SQLite. The server recalculates affected sibling positions; no fractional ordering schema is needed solely for smaller packets. A branch move should not require descendant field updates or one wire entry for every renumbered sibling.

## Atomicity and conflicts

Keep one list-wide content revision. Authorize the current owner/installation, check for an existing receipt, then compare the base revision and apply/validate all operations in one write transaction. The item row diff, title/revision change and receipt must commit together. Failed validation or storage rolls everything back; stale revisions apply nothing. There is no automatic merging of concurrent browser/Telegram changes in this proposal.

A semantic no-op detected locally sends nothing. A non-empty valid submitted batch advances the revision once, preserving the existing write/acknowledgement contract.

## Lost responses and bounded receipts

Agreed retention: 24 hours, capped at the latest 10,000 per owner (whichever bound removes a receipt first). Verify their actual storage footprint during implementation.

Receipt identity is installation + owner + list + operationId. Store a SHA-256 hash of a canonical decoded/validated packet, applied revision and timestamps; do not store another copy of private item text. Operation order and field presence are significant. JSON key order, whitespace and gzip bytes must not change the hash.

- Known operation ID with the same packet: return the stored acknowledgement without another write or revision increment. Authenticate and authorize before returning a receipt.
- Known operation ID with a different packet: reject explicitly (409 operation_id_reused).
- Missing/expired/evicted receipt: the original base revision is still checked. A previously committed batch has already advanced it, so retry cannot silently apply twice; it may now return a revision conflict rather than its old acknowledgement.
- The client never reuses an operation ID for a new batch or rebases the same packet onto a new revision automatically. When acknowledgement lookup is unavailable, use existing snapshot reconciliation: semantic equality can recognize the target; otherwise preserve local edits and show conflict recovery.
- Restoration clears receipts and changes installation identity. Old requests/drafts cannot cross that identity change. Deleted lists must not be recreated by a replay.

A replayed acknowledgement advances only the baseline for its frozen target; it never replaces newer local edits. Another device may already have advanced the server beyond that acknowledgement, in which case the next save or remote refresh uses existing revision/conflict rules.

## Compatibility and fallback

Propose advertising incrementalSaveVersion:1 through /api/session. Without that capability, keep the existing PUT snapshot path. Retain snapshot GET, JSON import/export, drafts and explicit recovery. Larger worthwhile batches can use negotiated gzip too.

Choose between a batch and a snapshot before sending either request, using measured encoded sizes and bounded planning cost. Use a snapshot when the change set is unsupported or not smaller; if the target itself exceeds existing limits, report an error and preserve drafts. Never send a blind snapshot fallback after an uncertain PATCH result. Capability/rollback changes require reload or reconciliation, not a second write with guessed state.

Proposed limits: at most 10,000 item operations, the existing 1-MiB wire/decoded save envelope budget, and the existing complete resulting-document limits (5,000 items, depth 32, field bounds and snapshot save-size budget). Temporary planner/server structures must also have explicit bounds for create-before-delete batches. Empty/unknown/duplicate/conflicting operation cases need a normative validation table before coding.

## Measurement target and remaining agreement

Propose at least 90% fewer request-body bytes than M14 gzip snapshots for a short isolated text edit (up to 200 characters) or a single branch move in a 1,000+ item list. Large note replacements, bulk insertions and sorting should select the cheaper valid transport rather than promise that target for every operation. Measure client planning/encoding, server validation/transaction latency and receipt storage alongside bytes.

Before implementation, agree the operation/clearing/deletion rules, receipt bounds, conflict policy and fallback. Then specify the exact create fields/defaults, canonical hashing representation, error codes, temporary-state bounds and additive receipt migration. Add tests for concurrent edits, own edits during a flight, retry after another device writes, receipt eviction/expiry, ID reuse, foreign item/anchor IDs, cycle attempts, branch deletion with rescued children, undo/redo, account changes and restore isolation.
