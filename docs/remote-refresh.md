# Cross-device refresh

Implemented after authorization on 2026-10-30. Each visible browser checks the owned list index every 15 seconds and when focus/visibility/network returns. It reuses the existing small list summaries (including revision, title and count), rather than fetching full lists on every interval. Checks do not overlap and pause during workspace operations, authentication loss and disposal. Only changed cached lists need a full GET; unopened lists use the refreshed index. Switching a cached list schedules a check too. Polling errors retain local content and offer retry.

Clean, saved navigation sessions can accept server snapshots automatically. Each accepted snapshot creates a fresh editor/autosave baseline: undo and redo are empty, surviving active item/collapse choices are retained, and the UI restores viewport/focus without scrolling to a search result again. The independent outline-preference queue is preserved.

Dirty, saving, failed/conflicted or actively edited sessions are never replaced. Title editing, note/tag/date dialogs and active tag filters also defer automatic acceptance. Checks repeat these guards after the network response, so typing or starting a dialog during a GET cannot be overwritten. The UI explains that another device changed the list and exposes existing load-server/save-as-copy/download recovery. Closing an unapplied dialog permits the next clean refresh; applying a draft uses normal revision-checked saving, with explicit conflict resolution if needed.

A remotely deleted cached list stays available locally for download or saving as a new list. It is not silently discarded. A failure while fetching a changed list also preserves that session.

This is not collaborative editing or automatic merging: simultaneous writes can still conflict, and HTTP revision checks remain authoritative. A remote snapshot intentionally starts a new undo history so old local history cannot undo another device's changes. SSE may later replace the timer as an invalidation source; save-protocol optimization remains separate.

On mobile (up to 620px), a Choose a list button shows the active title and opens a labelled native modal with a vertically scrollable list. Selection closes the dialog; Escape/cancel returns focus to the trigger. Desktop keeps its sidebar.

## Verification

71 frontend tests pass, including remote baselines/history, dirty/modal/deleted-list protection, edits during fetch, stale index responses after workspace operations and own-save acknowledgements. The full browser run passed 52 editor and 4 authenticated scenarios; final focused checks cover the refreshed UI and mobile chooser. Svelte/TypeScript and formatting checks pass, and the production frontend builds. Browser data is disposable; no database schema or backend API change is required. The user verified and accepted the latest cross-device/mobile fixes on 2026-10-30.
