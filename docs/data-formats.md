# Data model and formats — v1 proposal

## Canonical model

Support for plain items and tasks with checkboxes is agreed. The technical schema below remains proposed.

A list has a stable ID, a title, and ordered root nodes. A node has a stable ID, `kind` (`item` or `task`), Markdown text, completion status, and ordered children. IDs are generated independently of text and position. Agreed format: UUIDv4 as canonical strings; see [Database and migrations](database.md). IDs such as `node-1` below are readable placeholders, not valid proposed runtime IDs.

Snapshots use a nested tree: arrays define order, with no duplicated `parentId`. Invariants: unique IDs within the workspace, no cycles or shared descendants, each non-root node has exactly one parent, and `completed` is always false for `item`. Revision belongs to the server record, not the portable document. Database rows use parent references, while portable snapshots remain nested. Each list belongs to a user; import/export is scoped to the authenticated user and does not carry ownership credentials.

Tags, dates, and separate notes are not included in the schema yet because they are assigned to later milestones M6–M9. Collapse state, cursor position, drafts, undo history, and credentials are not part of portable content.

## JSON

JSON is a complete portable copy of supported list data with stable IDs, not a backup of the entire installation. The envelope always contains `schemaVersion` and a `lists` array, even for a single list.

```json
{
  "schemaVersion": 1,
  "lists": [
    {
      "id": "list-1",
      "title": "Personal",
      "nodes": [
        {
          "id": "node-1",
          "kind": "item",
          "text": "Travel",
          "completed": false,
          "children": [
            {
              "id": "node-2",
              "kind": "task",
              "text": "Buy **tickets**",
              "completed": false,
              "children": []
            }
          ]
        }
      ]
    }
  ]
}
```

Export → validation → read must preserve the model without loss, regardless of JSON formatting. Reject unknown newer versions or unknown fields with an explanation rather than silently discarding them. Migrations from older versions must be explicit and verifiable.

By default, import creates new lists and IDs without overwriting existing data; apply the old→new mapping throughout the document. A separate restore mode preserving IDs requires collision checks and explicit user selection. Merge by ID is not promised in v1.

## Markdown

Proposal: one list per `.md` file, titled by the first H1 heading, or by the filename if there is no heading. Export uses `-`, four spaces per nesting level, and task markers `[ ]` / `[x]`.

```markdown
# Personal

- Travel
    - [ ] Buy **tickets**
    - [x] Check passport
```

Markdown carries order, nesting, text, and task type/completion. Stable IDs are not preserved. Markdown workspace export in v1 may be limited to exporting individual lists; ZIP export is a separate decision.

Parse Markdown through an AST parser, not regular expressions. The initial supported subset includes unordered/ordered lists, nested lists, checkboxes, inline Markdown, and multiline item text. Ordered-list numbering is normalized to node order; its presentation is not preserved.

Before implementation, define fixtures for continuation lines, empty items, nested formatting, literal `[ ]` text, backticks, and line breaks. Recognize task markers only as task-list syntax; the exporter must escape literal markers in plain items.

Arbitrary Markdown documents do not guarantee round-trip preservation. Do not silently discard tables, HTML, multiple headings, code blocks, or paragraphs outside lists: preview unsupported constructs and block applying the import until the user chooses an explicit conversion or corrects the file. Agree on specific multiline-text rules using examples.

## Safe import

First read the file, validate its schema/structure, and preview list/node counts, warnings, and the intended action. Write only after confirmation. Partial imports are unacceptable: a failure leaves existing data unchanged.

Define file-size, text-length, node-count, and depth limits before implementation and validate them on both client and server. Errors include the file location or JSON path. Checks: JSON round-trip, supported Markdown subset round-trip, invalid structure rejection, ID collisions, and absence of partial writes.
