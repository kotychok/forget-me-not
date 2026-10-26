# M1 — Local editor implementation

Status: implemented and verified; user review pending. Authorized by the user's request to try the next stage.

## Scope

Implement the Svelte/TypeScript editor and a framework-independent command/history model. Support a session-only list, keyboard editing, branch operations, plain items/tasks, collapse, undo/redo, and native Makefile commands. No backend, persistence, import/export, or deployment in M1.

## Prototype defaults

Use the documented proposed shortcuts. Enter on an empty item creates a sibling. Task completion is independent of descendants; completed items remain visible. Conversion to/from a task clears completion and preserves identity and children. Collapse is view state outside content history. Expose commands in a labeled toolbar. These defaults can be adjusted after trying the prototype.

## Work and verification

1. Set up Vite/Svelte/TypeScript with locked dependencies and Makefile entry points.
2. Implement immutable tree operations and session history preserving focus/selection.
3. Build the editor and keyboard/composition handling with an explicit session-only notice.
4. Verify model invariants, history, browser focus/selection, IME guards, and empty-list recovery.
5. Run checks/build and record evidence and remaining limitations here.

The user makes commits. User review of the editing feel remains required before calling the whole milestone accepted.

## Verification evidence — 2026-10-26

- `make check`: Svelte/TypeScript reported zero errors and warnings; Prettier passed.
- `make test`: all 9 tree/model/history tests passed.
- `make build`: production frontend build passed.
- `make test-browser`: all 6 Playwright Chromium scenarios passed, including cursor restoration, indent/outdent, navigation, completion, composition guard, empty-list recovery, reload reset, and narrow-viewport overflow.
- Desktop screenshot inspected at 1440 × 1000. The prototype was served on localhost for review.
- `git diff --check` and local documentation link checks passed.

Verification used Node 24.22.1 and pnpm 11.25.0 from the available Codex runtime because `node` was not on the shell PATH. No global runtime or shell configuration was changed. Browser binaries and the dependency download cache were placed in temporary directories. Native use outside this session requires Node and pnpm on PATH as documented in README.

Browser automation uses Chromium on macOS. The IME check exercises composition events and command guards, not a real OS input-method session. Manual keyboard/screen-reader testing on other browsers and operating systems remains pending. Formatting and type checks are configured; a separate lint tool is not part of this prototype.

M1 does not implement Markdown display rendering, multi-list management, persistence, or recovery. These limitations are explicit in README/UI or assigned to later milestones. User review of the editing feel is pending; M1 is not yet marked fully accepted.

## Review follow-up — 2026-10-26

Implemented Del branch deletion in navigation mode and a native modal keyboard guide with Escape/close-button dismissal and focus restoration. Character deletion in text editing remains native. Guarded queued textarea selection events so leaving edit mode cannot inadvertently change a later undo snapshot back to editing. Heading-based list renaming is recorded for M2 rather than implemented in the session-only prototype.

Verification: all 8 browser scenarios passed, including the two new shortcut/dialog cases; the 9 model tests passed; Svelte/TypeScript and formatting checks passed without warnings; production build passed. Browser coverage remains Chromium on macOS.
