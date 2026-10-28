# Due dates — M10

The user selected one deadline without a time; no scheduled-start date or reminder. Optional `dueDate` is a real Gregorian calendar date in YYYY-MM-DD form, years 0001–9999. It is a calendar string, never midnight UTC, a timestamp or an installation timezone setting. Leap-year rules are checked independently in TypeScript and Rust; empty/null/invalid strings are rejected in files and API input. Absence means no date.

## Editing and display

Focus an item in navigation and press D, or choose Date in the toolbar. The modal offers the browser date input, Apply date, Clear date and Cancel. Clear only edits the modal draft until Apply. Apply is one undoable content command; unchanged values add no history. Cancel, Close or Escape discards the modal draft and restores item focus. Unapplied date edits trigger the existing style of unload warning but are not durable drafts.

Dates may be attached to plain items as well as tasks. This keeps metadata intact when converting a dated task to a plain item and back; adding a date never silently changes item kind. Moving, nesting, deletion/undo and tag filtering keep dates with the item. In a filtered list, date edits are allowed because they do not change structure or tag membership.

Badges always show the original YYYY-MM-DD date. An incomplete task or plain item before the browser's local day is Overdue; the same day is Today. Future dates display without an urgency suffix. Completed tasks show Done and no overdue warning. Local day is refreshed every 30 seconds and on window focus/visibility return, without changing content, revision or history. Different device timezones may disagree about Today near midnight, but the stored deadline never shifts. There is no automatic rescheduling, sorting, calendar view, date filter, notification or recurrence.

Search includes literal dates as separately labelled Due date results and validates the current value before jumping. It reveals/focuses the item once without opening the date dialog automatically. No natural-language date queries are supported.

## Persistence and portability

The additive migration adds nullable `items.due_date`; existing content, IDs, revisions, notes/tags and collapse preferences remain intact. Restart the backend (for example restart `make dev`) to apply embedded migrations. Dates use existing owned-list snapshots, atomic row diffs, conflict checks, IndexedDB drafts and new-copy recovery. Semantic equality includes dates, so lost-response reconciliation cannot confuse different deadlines.

JSON v4 adds optional dueDate. Exports use v4, accept v1–v3 without date fields and upgrade them to v4. Older versions carrying dueDate are rejected even if null or empty; newer unsupported versions also fail explicitly. Clearing omits dueDate. Old drafts without dates remain valid; applied dates survive draft recovery and copy import. Older application versions cannot read v4 exports.

Outline-Markdown export refuses a list with any due date and recommends JSON rather than silently losing metadata. The existing outline dialect does not acquire a date syntax. Database migration versions, JSON schema versions and list/content revisions remain separate.
