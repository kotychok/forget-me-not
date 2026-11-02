# M14b — Version 1 technical contract

Implemented for review on 2026-11-02 after explicit user authorization. This is the version-1 wire contract; see the [implementation record](plans/m14b-incremental-saves.md) for verification. Product behavior follows the [agreed design](incremental-saves.md).

## Endpoint and negotiation

- PATCH /api/lists/:id, Content-Type: application/json; optional negotiated Content-Encoding: gzip.
- GET /api/session advertises incrementalSaveVersion:1. Absent/unknown capability selects the existing snapshot PUT protocol.
- Existing password-session, Host/Origin/CSRF, expected-owner and expected-installation checks apply before processing a batch. No owner or installation identity is accepted from its JSON body.
- Snapshot GET/PUT, JSON/Markdown file transfer and gzip negotiation retain their existing contracts.

## Envelope

Required fields: protocolVersion (integer 1), operationId (canonical UUIDv4), baseRevision (nonnegative safe integer), ops (ordered array). Optional title is a string under the existing list-title rules; null is invalid. Reject unknown fields, duplicate object keys, fractional revision numbers and unsupported protocol versions. The largest accepted base revision is 2^53-2 so the acknowledged next revision is still exactly representable by JavaScript.

```json
{
  "protocolVersion": 1,
  "operationId": "90de58d3-9654-4c25-a34f-10fbaf3d872f",
  "baseRevision": 12,
  "ops": [
    {
      "type": "update",
      "itemId": "9af228dd-f9cd-48d8-930c-7ada56636b2d",
      "changes": {"note": "", "dueDate": null}
    },
    {
      "type": "move",
      "itemId": "9af228dd-f9cd-48d8-930c-7ada56636b2d",
      "parentId": "e1d5ef46-584a-4568-9e55-67b2cb753b2a",
      "afterId": null
    }
  ]
}
```

IDs are illustrative canonical values, not real content. A title-only packet uses ops:[] with title present. An empty ops array without title is invalid. The client sends no semantic no-op; a valid submitted packet advances the list revision exactly once even if its assignments happen to equal current values.

## Operation schemas

Every object rejects unknown fields. All item, parent and sibling IDs use the existing canonical UUIDv4 contract; null is permitted only where explicitly stated.

### update

```json
{"type":"update","itemId":"9af228dd-f9cd-48d8-930c-7ada56636b2d","changes":{"text":"New text","tags":[]}}
```

changes must contain at least one of text, note, tags, dueDate, kind, completed. Omitted fields are unchanged. text/note are literal strings; tags is an ordered string array; dueDate is a Gregorian YYYY-MM-DD string or null; kind is item/task; completed is boolean. Null is invalid for all other fields. Existing text/note/tag/date bounds apply. Text may be empty; note:"", tags:[] and dueDate:null clear those fields. Structural fields and item IDs cannot be changed through update. Kind/completion consistency is checked on the final tree.

### create

```json
{
  "type":"create",
  "item":{"id":"9af228dd-f9cd-48d8-930c-7ada56636b2d","kind":"item","text":"New item","completed":false},
  "parentId":null,
  "afterId":null
}
```

Required item fields are id, kind, text, completed. Optional note defaults to "", tags defaults to [], and dueDate defaults to null. Explicit null is accepted only for dueDate. children, parentId and position are forbidden inside item; each new node is an independent create operation. Placement fields parentId/afterId are required, including explicit null for root/first.

The ID must be new: reject any ID already present in the original list, elsewhere in the database, or created earlier in this packet, including a create/remove/create sequence. No item identity is reassigned or resurrected. New parents and anchors must exist when the operation executes. References to nodes created earlier in this packet are valid.

### move

```json
{"type":"move","itemId":"9af228dd-f9cd-48d8-930c-7ada56636b2d","parentId":null,"afterId":null}
```

Both placement fields are required. parentId:null means root; afterId:null means first in the chosen group. Reattach the entire branch. Resolve the destination sibling anchor after detaching the moving branch: it must exist in that destination group. Self-anchor, self-parent, moving into a descendant and any cycle are invalid. Root-to-root reordering uses the same operation. Unchanged descendants are not transmitted or recreated.

### remove

```json
{"type":"remove","itemId":"9af228dd-f9cd-48d8-930c-7ada56636b2d"}
```

Remove this item and all descendants still attached at that step. A surviving child must be moved out first. A second removal or later reference to an already removed item is invalid. A child removed explicitly followed by removal of its remaining parent is valid, although the planner should avoid redundant operations.

## Ordered application and planning

Operations execute sequentially against an owned in-memory working tree. Repeated updates/moves of an existing item are permitted in order; later assignments/placements win. References are checked at their execution point. The normal client planner coalesces final field changes rather than emitting repeated keypress operations. Supplied fields are typed and bounded immediately; cross-field completion consistency and final document limits are checked before committing.

The planner builds changes from the complete last-acknowledged baseline to a frozen target:

1. Traverse the target in parent-before-child order. Create new nodes and place/move surviving branch roots using already available parent/sibling IDs.
2. Emit changed fields for surviving nodes; creation already carries each new node's final fields.
3. Remove obsolete branch roots after all surviving descendants have been rescued.
4. Simulate the exact packet against the baseline and compare its result with the target using the established semantic document comparison. If it cannot safely represent the target, choose snapshot transport before any HTTP request.

No sort position from the client is trusted. Normalize final sibling order into the existing integer database positions and apply a row diff. Preserve existing item IDs/creation timestamps; do not copy unchanged descendants as new rows.

One request is in flight per list. Its original operation ID, packet, base revision and frozen target remain immutable until resolved. An acknowledgement advances the baseline to that target only; edits made afterward stay pending and are diffed against the newly acknowledged baseline. Background remote acceptance keeps the existing clean-session/history-reset rules; no merge is added.

## Request and work limits

Initial technical defaults:

| Limit | Proposed value |
| --- | --- |
| Wire request body | 1 MiB |
| Decoded JSON request body | 1 MiB |
| Item operations | 10,000 |
| Live temporary nodes | 10,000 |
| Temporary structural depth | 64 |
| Final nodes/depth | Existing 5,000 / 32 |
| Final text/note/tags/dates/title | Existing shared validators |
| Final snapshot envelope | At most 1 MiB of the existing canonical JSON save representation |
| Conservative work estimate | (baseline node count + create count) × max(1, operation count) ≤ 2,000,000 |

The conservative work estimate is computable by both client and server before simulation. It deliberately sends bulk changes through snapshot PUT rather than allowing expensive arbitrary operation sequences. It is a bound, not a latency guarantee; measure it on representative lists before final implementation acceptance. The client chooses the snapshot before sending if its batch exceeds a limit and the complete target snapshot is still valid. The server independently enforces every bound; it never partially applies a too-complex batch.

The final snapshot-size check includes document, baseRevision and JSON escaping, rather than trusting compressed bytes. This prevents repeated small patches from growing a document beyond what existing save/recovery paths can handle. Temporary nodes/depth allow bounded create-before-delete work while the committed tree remains within existing limits. All structural traversals must detect cycles and stay within the temporary bounds.

## Transaction and acknowledgement

Within one owner-scoped write transaction:

1. Serialize with other writers and confirm that the current list exists and is owned by the authenticated principal. Validate installation/request scope; do not expose another owner's receipt.
2. Check an unexpired matching receipt before enforcing a new base-revision comparison. Matching packet hash returns the original acknowledgement without mutation, even if other writers have advanced the list.
3. A known operation ID with different content is rejected. Without a usable receipt, compare baseRevision with the current list revision. A mismatch returns conflict with no content write.
4. Load the current tree, enforce work bounds, simulate and validate the final document. Apply its row diff and title, increment the revision once and insert the receipt in the same transaction.
5. Prune expired/over-cap receipts and commit. No successful response is returned before commit. Any failure rolls back content, revision and receipt together.

The success body is stable on both initial application and replay:

```json
{"protocolVersion":1,"operationId":"90de58d3-9654-4c25-a34f-10fbaf3d872f","revision":13}
```

The acknowledgement revision is the applied revision, not the server's latest revision on replay. It contains no server-normalized replacement tree. Another device's later changes are handled by normal polling/CAS rather than overwriting newer local edits with an acknowledgement.

## Canonical packet hash

Server-computed SHA-256 is over UTF-8 canonical JSON of an object containing the URL listId and the parsed packet:

- Normalize create's omitted optional fields to their documented defaults. Their explicit default values therefore hash identically.
- Preserve update field presence, title presence, operation order and all literal string/array values. Do not trim or Unicode-normalize user text or reorder tags.
- Recursively sort object keys; emit compact JSON with no insignificant whitespace, integer numbers in canonical decimal form, and strings using the fixed serde_json UTF-8 serialization convention. All accepted object keys are known ASCII schema keys. Reject duplicate object keys before hashing.
- Compression, source JSON key order and escape spelling (for example literal Unicode versus equivalent JSON escapes) do not affect the decoded canonical representation.

This is an application-defined canonical form, not a claim to implement every JSON canonicalization standard. Use fixed hash vectors and preserve the version-1 definition across serializer changes; a future incompatible form needs a new negotiated protocol version.

## Receipt storage and expiry

Add a new SQLx migration, leaving applied migrations unchanged. Proposed table fields: internal receipt_seq INTEGER PRIMARY KEY AUTOINCREMENT; installation_id, owner_id, list_id, operation_id; request_hash (32-byte BLOB); applied_revision; created_at and expires_at (server UTC epoch seconds).

Use a unique key on installation/owner/list/operation ID, an expiry index and an owner/receipt-sequence index. Owner/list references cascade on deletion. Keep the latest 10,000 per owner across their lists, sorted by insertion sequence; replay does not extend expiry or move a receipt to the end. Expiry is 24 hours from successful creation, not from last retry. Expired entries are immediately ineligible for replay; garbage collection runs on writes/startup and periodically. Garbage-collection delay never extends replay eligibility.

No request payload, item text, bearer secret or password belongs in this table. Restore clears receipts and changes the installation ID. A request for a now-deleted/foreign list fails even if a receipt once existed.

When a receipt expires or is evicted, retrying the original packet still carries its old base revision. A prior commit has already advanced that revision, preventing duplicate application. Read/reconcile the snapshot if the acknowledgement is no longer available; preserve local edits if the target no longer matches. Never assign a new ID/base revision to the unresolved old attempt merely to force it through.

## Errors

Domain errors use {error: human-readable message, code: stable identifier}. Retain existing authentication and transport error behavior; middleware/extraction errors may use their current body formats, so clients must also handle HTTP status without a structured code.

| HTTP | Code / category | Meaning |
| --- | --- | --- |
| 400 | Malformed JSON/encoding | Cannot decode a packet; no write |
| 401/403 | Existing auth/scope/CSRF checks | No batch/receipt access granted |
| 404 | list_not_found | Missing or not owned; no existence distinction |
| 409 | revision_conflict | No matching receipt and stale base revision |
| 409 | operation_id_reused | Known receipt ID with a different canonical packet |
| 413 | Existing body limits | Wire or decoded body exceeds 1 MiB |
| 415 | Existing content/encoding checks | Unsupported content type or Content-Encoding |
| 422 | unsupported_save_version | Unknown protocolVersion |
| 422 | invalid_batch | Unknown/missing fields, types, duplicate keys or empty packet |
| 422 | invalid_reference | Item/parent/anchor unavailable in this list at this step; foreign and absent references share this result |
| 422 | invalid_structure | Self-reference, cycle or invalid destination sibling group |
| 422 | limit_exceeded | Operation/work/temporary/final document limits exceeded |
| 500 | storage_error | Uncertain from the client's perspective if the response was lost or commit outcome cannot be known |

On a network/timeout error, retain the immutable attempt. A deliberate retry can resend that same PATCH to recover its stored acknowledgement; 409 revision_conflict or an unavailable receipt triggers snapshot reconciliation, not rebasing or blind PUT. operation_id_reused is a protocol error to surface and investigate, not an invitation to retry with a fresh ID automatically. Authentication loss pauses the queue and retains the existing owner/installation protections. Definitive validation failures preserve drafts and expose the error; they do not create a receipt.

## Transport selection and acceptance

For each frozen target, compare the actual encoded candidate bodies using the negotiated gzip rules. Choose PATCH only when its final body is smaller than the snapshot candidate and the planner's work/size bounds pass. Otherwise choose the existing PUT before sending. No-op detection precedes both choices. Receipts add server storage, not another request on the ordinary successful path.

Proposed measurement target: ≥90% fewer upload bytes than M14 gzip snapshots for one short text edit (≤200 characters) or one branch-root move in a 1,000+ item list. Measure planning/encoding, transaction latency, receipt storage and cleanup. Bulk changes need only choose the cheaper valid representation; no universal 90% claim is made.

Implementation acceptance must cover fixed canonical-hash vectors; create defaults and field clearing; move/reorder/cycle cases; deletion with rescued descendants; ID collisions and foreign references; late local edits; lost response and replay after another writer commits; receipt expiry/eviction/ID reuse; account/installation changes; restore isolation; plain/gzip/old-client fallback and size/work bounds. A meaningful failure must leave the complete existing snapshot recovery path usable.
