# Item notes — M7

Each item or task can have one separate plain-text note, up to 64 KiB UTF-8. Empty means no note. Notes are content, not outline-view metadata. They travel with the item when a branch is moved/copied, and use normal content revisions, autosave, conflicts, local drafts, and JSON portability.

## Editing

Focus an item in navigation and press N, or use the toolbar Note action. Items with notes have a small note button. The modal shows the item text and full note source. Enter inserts a newline; normal textarea editing/undo works inside the draft. The textarea always edits literal source. M9 adds an optional read-only Markdown preview of the modal draft; it does not apply changes. HTML remains literal and images do not load. See [Markdown display](markdown-display.md).

Apply note commits one undoable editor command and schedules ordinary autosave. Cancel, Escape, or Close discards the modal draft and returns focus to the item, without modifying content or history. Applying an empty note removes it; undo restores it. The size counter disables Apply above 65,536 bytes. The independent 1 MiB list-save limit still applies.

Unapplied modal text is not a durable local draft; leaving the page while it differs from the original triggers an unload warning. Applied changes use the existing IndexedDB draft flow. Importing or recovering creates new IDs and preserves notes. Concurrent edits follow M4 revision checks without merging or silently overwriting notes.

## Search and files

Search includes notes. Note matches are separate results labelled Note, with list/item/ancestor context. Activating one reveals its item and opens the note modal; a stale note match is rejected before selection. The search jump remains one-shot across list switches.

Notes were introduced in schemaVersion 2; current M8 exports use schemaVersion 3 with tags. The optional `note` string defaults to empty and is omitted when empty. Both frontend/backend reject note fields in v1 files; v1 without notes and v2 notes files are accepted and upgraded to the current schema. Unknown fields, unsupported future versions, and existing bounds remain rejected. API item payloads and old stored drafts without `note` remain valid empty-note records.

Outline Markdown does not represent separate notes. Exporting a list with notes fails explicitly and recommends JSON; it never silently drops them. Markdown imports create items with empty notes. Markdown rendering inside notes is not part of M7.

## Persistence and boundaries

The additive migration `20261027000400_item_notes.sql` adds non-null `items.note` with an empty default. Item validation bounds it independently of item text. Existing row-diff saves read/write notes atomically with other content; owner checks remain at the list boundary. View-preference rows and revisions are unchanged.

Editor owns the pure setNote command/history. NoteDialog owns only the temporary modal draft and size/focus/close behavior. EditorPane connects note commands to the existing dirty notification; it does not fetch. Portable conversion and semantic document comparison include notes so acknowledgement/recovery cannot mistake a different note for identical content.
