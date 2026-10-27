# Editor behavior — draft contract

Agreed: nested lists, our own convenient shortcuts, plain items, and tasks with checkboxes. Enter creates a sibling after the current branch without splitting text; Shift+Enter inserts a line break. Navigation/edit modes and conversion between plain items and tasks are also agreed. Detailed shortcuts and remaining behavior below are proposed.

## Focus and modes

Agreed: there is an active item and two modes: navigation and text editing. Proposed entry/exit behavior: Clicking text or pressing F2 starts editing; Escape ends editing, keeps the input in the local model, and focuses the item. Escape does not discard typed text; use undo for that. Exception: Escape cancels an untouched newly added item and returns to the previous item in navigation mode (or the empty-list add button). Cancellation restores history from before the addition, so redo does not recreate the cancelled item. Typing, a successful structural change, leaving the item, or undo/redo ends this cancellation window; existing empty items are preserved.

After a structural operation, focus stays on the moved item. After deletion, focus moves to the next visible item, then the previous one, or the empty list. Focus and cursor position are tied to IDs rather than DOM indices. An empty list always offers an accessible add action.

On item text in either navigation or editing mode, Tab/Shift+Tab indent/outdent the whole branch and preserve the current mode and active item. In editing, Escape returns to navigation. In navigation, Escape focuses the toolbar Add item button, allowing normal page Tab navigation without a keyboard trap. Outside item text controls, Tab/Shift+Tab retain standard page focus navigation. Commands also appear in an accessible menu; drag-and-drop is not required. Before implementation, check shortcut conflicts on macOS, Windows/Linux, and with screen readers.

## Commands

`Mod` means Cmd on macOS and Ctrl on Windows/Linux. Enter and Shift+Enter behavior is agreed; other entries are proposed.

| Key / action | Result |
| --- | --- |
| Enter in navigation | Create a sibling after the current branch and start editing it |
| Enter in text | Same behavior; do not split text or change structure based on cursor position |
| Shift+Enter in text | Insert a line break within the item text |
| Tab on item text (navigation or editing) | Indent under the previous sibling; no change if none exists |
| Shift+Tab on item text (navigation or editing) | Outdent after the parent branch; no change at the root |
| Alt+↑ / Alt+↓ | Swap the branch with the previous/next sibling at the same level |
| ↑ / ↓ in navigation | Focus the previous/next visible item |
| ← in navigation | Collapse an expanded branch; otherwise focus the parent |
| → in navigation | Expand the branch; if already expanded, focus its first child |
| Space in navigation | Toggle task completion; leave plain items unchanged |
| Mod+Z / Mod+Shift+Z | Undo / redo editor commands |
| Del in navigation / Delete branch action | Delete the item and its children, with undo available |

In a textarea, ordinary arrows, Space, and Backspace behave as text input. Ordinary Backspace does not delete a branch. Del deletes a branch only in navigation mode; in text editing it retains normal character deletion. Enter on an empty item currently creates a sibling; automatic outdent or deletion is a separate decision. During IME composition, Enter must not trigger a structural command.

## Tree operations and tasks

- Move, indent, outdent, and delete always affect the entire branch.
- Indent appends the branch as the previous sibling's last child and expands that sibling.
- Outdent places the branch immediately after its former parent. The parent's other children stay in place.
- Collapsing hides children without changing data or completion status. Collapsing a branch with an active descendant moves focus to the parent.
- Plain items and tasks with checkboxes are agreed; proposed type names are `item` and `task`.
- Proposal: completing a task does not automatically complete descendants or change the parent status.
- Completed items stay in place. Automatic hiding/sorting can make navigation unpredictable, so it is not proposed for v1.
- Collapse state is separate browser UI state, not a change to list content.

## Item/task conversion

Agreed: a plain item can become a task with a checkbox and a task can become a plain item, preserving its ID, text, and children. Proposed interaction: an accessible item-menu action; a dedicated shortcut can be chosen during the prototype. Proposed semantics: conversion to a task starts incomplete; conversion back to a plain item clears completion. Conversion is a single undoable command. These completion details are not separately agreed yet.

## Undo/redo

One structural command is one history step. Group consecutive typing until a pause or a change of focus/structure; tune the interval in the prototype. History preserves focus and cursor position. A new edit after undo clears redo.

Autosave neither clears history nor creates a history step. To avoid conflicts with native textarea undo, text and structural edits need one coherent history with correct composition handling. This is a key prototype risk.

Keep history within the current session, separately for each open list; recovery after reload is not promised. Loading a different server version after a conflict starts a new history.

## Prototype verification scenarios

1. Create three items, indent the second, add a child, and move the branch; undo/redo restores the exact tree and focus.
2. Check Enter in the middle of text, empty items, multiline text, and IME input.
3. Collapse a branch, navigate only visible items, and return to the parent.
4. Edit during a slow save: the indicator must not show “Saved” prematurely.
5. Edit a list in two tabs: a conflict must preserve both versions.
6. Reload with an unsaved draft and recover it as a copy.

## Keyboard guide

The guide opens as a modal dialog with a close button and Escape dismissal. Focus stays inside while open and returns to the trigger on close. It does not change the list or add a history step.

Save status appears in a fixed, non-interactive overlay without shifting the editor. Saved notices disappear after 1.2 seconds; unsaved, saving, error, and conflict states remain visible until the state changes. The status remains available to assistive technology.

## Links and long-text editing (M5)

HTTP/HTTPS URLs in plain item text are detected without Markdown parsing. In navigation, URLs longer than 72 characters display a shortened source string (first 56 characters, ellipsis, last 12); a tooltip exposes the full source. All other text is displayed literally. Shortening never changes stored text or the link target.

Clicking item text or F2 still starts editing. Separate, underlined domain links below the item open the full address in a new tab with `noopener noreferrer`. In navigation, L focuses the first link; Tab moves between links, Enter activates one, and Escape on a link returns focus to the item. There is no automatic remote metadata fetch. Only validated HTTP/HTTPS URLs without embedded credentials become links; punctuation heuristics can leave ambiguous prose URLs as literal text. HTML is never interpreted.

Editing shows the full original text in a wrapping textarea whose height follows content and available width. Resizing is view-only and creates no history/save operation. Item text is the sole source; there are no new database or JSON fields.

Readable labels, Markdown link syntax, and separate comments remain deferred design options for M7 notes and M9 Markdown rendering. See [M5](milestones.md#m5--links-and-long-text-editing).

The item action toolbar sticks to the viewport top while scrolling within the editor, including long lists. Its opaque background separates controls from scrolling content; focused item text reserves scroll space below it.

## Remembering outline view state — planned M6b

Persisting collapsed/expanded branches across reloads is planned separately from M6a file transfer. Keep it outside list content, revisions, history, and JSON/Markdown formats. The current implementation retains collapse state only in cached sessions; persistence is not implemented yet. Agreed: store view preferences in the database per user/list and share them across devices on the same installation. Proposed: persist collapsed IDs with a separate revision and keep temporary search/undo expansion local. Refresh timing, concurrency, and focus-safe application of remote changes remain open; real-time push synchronization is not implicitly included. See [M6b](milestones.md#m6b--persistent-outline-view-state).

A floating Back to top button appears after scrolling more than 400 pixels. It returns to the page start and focuses the list heading (or active title input), using immediate scrolling when reduced motion is requested. It is positioned above the save notice and does not change editor content/history.
