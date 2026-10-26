# Editor behavior — draft contract

Agreed: nested lists, our own convenient shortcuts, plain items, and tasks with checkboxes. Enter creates a sibling after the current branch without splitting text; Shift+Enter inserts a line break. Navigation/edit modes and conversion between plain items and tasks are also agreed. Detailed shortcuts and remaining behavior below are proposed.

## Focus and modes

Agreed: there is an active item and two modes: navigation and text editing. Proposed entry/exit behavior: Clicking text or pressing F2 starts editing; Escape ends editing, keeps the input in the local model, and focuses the item. Escape does not discard typed text; use undo for that.

After a structural operation, focus stays on the moved item. After deletion, focus moves to the next visible item, then the previous one, or the empty list. Focus and cursor position are tied to IDs rather than DOM indices. An empty list always offers an accessible add action.

In navigation mode, Tab/Shift+Tab retain standard page focus navigation. In a textarea, they change indentation; Escape exits that mode. Commands also appear in an accessible menu; drag-and-drop is not required. Before implementation, check shortcut conflicts on macOS, Windows/Linux, and with screen readers.

## Commands

`Mod` means Cmd on macOS and Ctrl on Windows/Linux. Enter and Shift+Enter behavior is agreed; other entries are proposed.

| Key / action | Result |
| --- | --- |
| Enter in navigation | Create a sibling after the current branch and start editing it |
| Enter in text | Same behavior; do not split text or change structure based on cursor position |
| Shift+Enter in text | Insert a line break within the item text |
| Tab in text | Indent under the previous sibling; no change if none exists |
| Shift+Tab in text | Outdent after the parent branch; no change at the root |
| Alt+↑ / Alt+↓ | Swap the branch with the previous/next sibling at the same level |
| ↑ / ↓ in navigation | Focus the previous/next visible item |
| ← in navigation | Collapse an expanded branch; otherwise focus the parent |
| → in navigation | Expand the branch; if already expanded, focus its first child |
| Space in navigation | Toggle task completion; leave plain items unchanged |
| Mod+Z / Mod+Shift+Z | Undo / redo editor commands |
| Delete branch through menu | Delete the item and its children, with undo available |

In a textarea, ordinary arrows, Space, and Backspace behave as text input. Ordinary Backspace does not delete a branch. Enter on an empty item currently creates a sibling; automatic outdent or deletion is a separate decision. During IME composition, Enter must not trigger a structural command.

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
