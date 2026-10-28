# Search behavior

M6 adds cross-list search from the sidebar's **Search lists** button. Search is a trimmed, case-insensitive literal substring in list titles, item text, separate notes, and tag names. Cyrillic is supported; regex punctuation is literal. It includes completed tasks and collapsed branches. Note matches are labelled Note and open the item note modal after revealing the item. Tag hits are labelled Tags and reveal the item. Tag search is case-insensitive like other search fields; tag identity and tag filtering use exact case-sensitive names. Activating any search hit clears a current tag filter. It does not search a link's remote contents.

## Results and navigation

The modal displays list title, ancestor path, and a highlighted text snippet. A title match is a separate result and can open an empty list. Show the first 200 hits in list/tree order with the full hit count; refine the query if there are more. This is not a filter that changes the stored tree.

Arrow Down from the query enters results; Up/Down moves through them, Up from the first returns to the query, and Enter opens a focused result. Native Tab and Escape work within the modal. Opening a match closes search, expands its ancestors, scrolls it into view below the sticky toolbar, and focuses the item in navigation mode. The matching row/text is highlighted without changing content. Editing displays literal original source. Title-only results focus the heading.

A result jump is consumed once: switching lists or remounting the editor must not scroll or refocus the last search hit again. The remaining highlight is presentation only. A visible Search result indicator and Clear search button appear in the sticky item toolbar. Clearing removes the highlight/context and retained query while keeping the current item/focus; Clear search is also available inside the modal.

Reopen Search lists to return to the retained query with freshly loaded results unless it was explicitly cleared. Refresh search also reloads while the modal is open. Loading, empty results, and read failures are explicit. The modal stays open with an error if a selected list/item was deleted or no longer matches the query. Retry by refreshing; a failed transition preserves the selected list.

## Data and consistency

Use the existing owner-scoped read-only export snapshot; overlay documents from open sessions so local unsaved/conflicting edits are searchable. Searching never flushes saves, resets history, or overwrites a cached session. A cached session remains the local version even when another tab has changed its server counterpart. Opening checks server list access/existence and validates the target against the version that will be displayed. An already-open local version may intentionally differ from the server; M4 conflict handling remains in effect.

Each open/refresh reads a bounded snapshot, not a live subscription. Changes in other tabs or while search remains open require refresh. A reachable server is required even when local sessions exist. Search respects existing snapshot limits: 100 lists, 10,000 items, 8 MiB, plus normal per-list limits; exceeding limits shows an error rather than a silently partial corpus. No new search index, database fields, migrations, or dependencies are added. Larger workspaces need a separately designed paginated server search.

M10 also searches dueDate calendar strings as separately labelled Due date results. Activation validates the current date, reveals/focuses the item and highlights its date badge. Queries remain literal (for example `2028-02`), without natural-language date parsing.
