# Item tags and filtering — M8

Items and tasks can have up to 12 tags, each 1–40 Unicode characters. A tag's identity is its exact name within the owner's data: names are case-sensitive, so `work` and `Work` are different tags. No case folding or Unicode normalization is performed. There is no global/shared-account catalog or separate tag ID. Owned-list access isolates tags just like text/notes. Cross-list rename, catalog management, tag colors, and multi-tag Boolean filters are not included.

## Editing and persistence

Tag-like text such as `#work` stays ordinary item text; tags are explicit metadata. Press T on an item in navigation, use the Tags toolbar action, or the edit-tags indicator on a tagged item. The modal accepts comma-separated names, trimming boundary whitespace. Apply commits one undoable editor operation; Cancel/Close/Escape discards the draft and restores item focus. Up to 20 existing tag names from the current list are offered as suggestions. Duplicate exact names, empty entries, commas within a name, control characters, malformed Unicode, excessive count, and names over 40 characters are rejected. Tag order in content is preserved.

Tag edits use ordinary content autosave, list revision checks, local drafts, history, copy, and recovery. Applying an empty list removes tags. Unapplied modal text is not a durable draft and participates in the page-unload warning. Semantic acknowledgement/draft comparison includes tags; a different tag set cannot be mistaken for acknowledged identical text.

The additive migration `20261028000500_item_tags.sql` adds `items.tags TEXT NOT NULL DEFAULT '[]'`. The server validates tag arrays and stores compact JSON within the owned item row, atomically with other item fields. Existing notes, IDs, content/view revisions and owner/installation identity are preserved. No new tag registry or schema for sharing is introduced.

## Filtered tree

Click a tag chip or choose Filter by tag in the sticky toolbar. The filter is an exact match in the current list. Show matching items plus their ancestor paths in original order and depth; unrelated siblings/descendants are hidden. Ancestors without the tag are labelled Context. Required paths appear expanded regardless of saved collapse preferences, without persisting that expansion.

Filtering is a UI projection; the authoritative tree, IDs, sibling order and exports remain complete. The toolbar shows the active tag, match count, context explanation, structural lock, and Clear tag filter. Clearing keeps the active item visible, temporarily revealing its ancestors if needed. The filter is local to the open pane and resets on switching lists; it is not a cross-device preference or file field.

While filtered:

- Enter/add, indent/outdent, branch moves, deletion and manual collapse are disabled. Keyboard equivalents are consumed without mutating hidden branches; clear the filter first.
- Up/Down traverse displayed rows. Left moves to the displayed parent; Right moves only to a displayed child. Escape from navigation clears the filter; in text editing, Escape first exits text editing.
- Text, notes, completion/conversion, and tags remain editable. Removing the active tag from the edited item clears the filter and keeps focus on that item.
- Undo/redo clears the filter before applying history so a structural history step cannot occur under a misleading partial view.
- Activating a global search result clears the filter before revealing its target. Search reveal remains one-shot.

## Search and formats

Global search also matches tag names using its existing case-insensitive literal matching, independently of exact-name tag identity and filtering. Tag hits are labelled Tags and reveal the owning item with ancestor context. Stale result checks confirm a current tag still matches.

JSON exports schemaVersion 3. Optional `tags` is an array; missing/empty means no tags, and empty arrays are omitted. V1/v2 input is still accepted and upgraded to v3 but must not contain tag fields. V1 also cannot contain note fields. Unknown fields/future versions and all existing byte/depth/item limits remain rejected. See the shared [v3 fixture](../fixtures/portable-v3.json).

Outline Markdown cannot represent separate tags and refuses export of a tagged list with a JSON recommendation; it never silently drops tags. Markdown imports create empty tags. JSON export under an active UI filter still includes the entire list. Database backups include tags; view preferences and filters remain separate from portable content.
