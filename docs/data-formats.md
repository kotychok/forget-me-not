# JSON data format — schema v2 with v1 import compatibility

Implemented: JSON and constrained outline-Markdown file import/export through compiled Rust adapters (M6a). This supersedes the earlier exclusion of Markdown file transfer. Markdown rendering inside item text is deferred to M9; all text is currently literal.

## Portable model

The envelope has exactly two fields: `schemaVersion: 2` and `lists`. Schema v1 is still accepted for input and normalized to v2; older readers limited to v1 cannot read the new v2 export. Each list has `id`, `title`, and `nodes`. Each nested item has `id`, `kind` (`item` or `task`), `text`, `completed`, and `children`, plus optional `note` in v2. Notes are literal UTF-8 text (up to 64 KiB); missing or empty means no note, and empty notes are omitted on export. V1 rejects note fields rather than silently dropping them. Arrays preserve list and sibling order. Plain items must have `completed: false`.

IDs are canonical lowercase UUIDv4 strings. List IDs must be unique within a file; item IDs must be unique across all lists in the file. Database rows use parent references; portable files use nested arrays without duplicated parent IDs.

See the [shared schema-v1 fixture](../fixtures/portable-v1.json) for a complete example with multiline Unicode text, literal formatting characters, nested tasks, and an empty list. Both frontend and backend test this legacy fixture and the [schema-v2 notes fixture](../fixtures/portable-v2.json).

JSON is a complete portable copy of supported list content, not a backup of the whole installation. Owner identity, account data, server timestamps, revisions, collapse state, cursor/selection, drafts, and undo history are excluded. Database migration versions, list revisions, and `schemaVersion` are independent.

Unknown fields and unsupported schema versions are rejected instead of silently discarded. A future schema migration must explicitly define how older files are read. Notes use schema v2 in M7. Future tags and dates require an explicit compatibility contract; they cannot be added as silently ignored fields.

## Export

- **Export current list** reads the selected session, preserving its latest local edits even if unsaved or conflicted. Export does not mark those edits saved on the server.
- **Export all lists** flushes the current tab's pending queues first; an error/conflict blocks this action. The server then reads all owned lists in one consistent SQLite transaction, ordered by list position. Changes from other tabs may therefore appear in this saved-data export.
- IDs are preserved in exports. Files use compact UTF-8 JSON and the same envelope for one or multiple lists. Downloads use a sanitized filename and do not include ownership or authentication metadata.
- Current-list JSON download remains local, including when the read-only conversion service is unavailable. Markdown requires that service and exports one list at a time.
- Exports over the supported file/list/item limits fail explicitly; they never silently omit lists. Export individual lists when a workspace exceeds batch limits.

## Import

1. Select a JSON or Markdown file. Check the 8 MiB raw-file limit and strict UTF-8 in the browser. JSON also keeps browser-side schema validation; all formats then use read-only server conversion and validation.
2. Preview filename, list titles, list count, total item count, and format notes. This performs no database writes; closing the dialog cancels without applying it.
3. Confirm **Import as new copies**. The backend validates again and generates fresh IDs for every list and item, even if source IDs do not collide with existing data.
4. Insert all lists and nodes in one transaction, owned by the server-resolved local user. Failure rolls the entire batch back. Existing lists are never modified.

Repeated intentional import creates another set of copies. ID-preserving restore, merge, and overwrite are not implemented. A missing network response is not proof of failure: import is not automatically retried, and the dialog explains that it may have completed. Use **Refresh list index** to check for completed imports without discarding local edits before selecting the file again.

## Limits and errors

| Limit | Value |
| --- | --- |
| File / import request | 8 MiB UTF-8 JSON |
| Lists per file | 1–100 |
| Items across the file | 10,000 |
| Items per list | 5,000 |
| Nesting | 32 item levels |
| Item text | 32 KiB UTF-8 |
| Item note | 64 KiB UTF-8 |
| List title | 1–200 Unicode characters, not blank |
| Serialized single-list save request | 1 MiB |

The per-list save limit ensures imported data can still be edited through normal autosave. Validation errors identify a JSON path and reason where possible. Invalid JSON/UTF-8 and oversized files fail before preview. Server validation failures return 422; oversized HTTP bodies return 413; unknown/non-owned export IDs return 404. Backend extraction errors can be plain text, which the API client handles.

## Markdown in item text — later

Literal `**bold**`, links, backticks, or HTML-looking text survive JSON round-trip unchanged today. M9 may add safe Markdown display rendering while keeping the underlying text editable and portable. That is separate from importing Markdown documents or using Markdown as the storage format.

## Outline-Markdown contract — M6a

This is a supported outline dialect, not a promise to interpret arbitrary Markdown. JSON remains the complete portable representation of supported content. Markdown rendering inside item text remains separate in M9.

- A separate top-level paragraph becomes a separate root item. A following unindented list does not implicitly become its children.
- Explicit indentation determines list nesting; support the three-space indentation present in the user's sample as well as the indentation emitted by our exporter. Do not infer parenthood from adjacent prose or labels.
- Bare `[ ] Item` and list-marked `- [ ] Item` represent incomplete tasks; `[x] Item` represents a completed task. Ordinary list entries and paragraphs are plain items. Literal words such as `Completed`, `x`, and `ok` do not imply completion.
- Bullet and numbered lists map to ordered sibling items; the original marker style is not part of our item model.
- The initial level-one heading supplies the title; accept optional closing hashes, as in `# demo #`. Further headings become literal root items with a line-numbered warning. Unindented non-list lines in the same paragraph are joined with newlines; blank lines end a paragraph.
- URL strings and surrounding comments remain item text. Do not fetch URLs or interpret raw HTML.
- Export a consistent explicit outline: one list title, `- Text` for plain items, `- [ ] Text` / `- [x] Text` for tasks, and two spaces per nesting level. Escape backslashes and Markdown punctuation that would change structure or task type. Continuation lines have two extra spaces; escaped leading markers remain text, and whitespace-only continuation lines preserve their spaces/newlines.
- Preview reports unsupported constructs or unavoidable losses; never silently discard text or invent nesting. A non-list continuation must directly follow its item and have at least two extra spaces; additional spaces become text. Indented prose after a separating blank line, orphan indentation, tabs in structural indentation, fenced code blocks, excessive depth, and limit violations produce explicit errors. Backslash escapes before punctuation are decoded.

For the agreed mixed-prose example, the task paragraph and each of the following five entries are six root items; only the first is a task. Our normalized export is:

```markdown
# demo

- [ ] Item
- Item
- Item 2
- Item
- Item
- item 2
```

Markdown does not carry internal item IDs, server metadata, or separate item notes. Lists containing notes cannot be exported to Markdown; use JSON v2. Markdown import creates empty notes. Markdown exports one current list at a time; JSON supports all lists. Titles with line breaks/surrounding whitespace, literal carriage returns in item text, and leading tab indentation cannot be exported losslessly and produce an explicit JSON-fallback error. Import creates new copies through the existing shared validation/transaction path. Full JSON portability remains available independently.

### Scale verification and revised limit

The user's largest current sample (about 284 KB, 2,976 list-marker lines plus prose) decoded and passed validation locally without database writes. Its final parsed count is not inferred from marker lines. The private file was removed from the repository at the user's request; tests use synthetic content only.

The per-list limit is now 5,000 on both frontend and backend. A synthetic 5,000-item browser workflow passed import, render, indentation, undo, text edit, acknowledged save, search/reveal, JSON export, and reload, retaining one intact list under the 1 MiB save bound. The 5,001st item is rejected. File/list/depth/text/title limits otherwise remain unchanged. This verifies the tested local Chromium workflow, not a latency guarantee on all hardware or on every 5,000-item document. Large item text may reach the independent 1 MiB save limit first.
