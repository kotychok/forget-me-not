# M5 — Links and long-text editing

Status: implemented and verified; awaiting user review. Authorized after the user committed the M4 work and roadmap reordering.

## Behavior and boundaries

`lib/links.ts` detects plain-text HTTP/HTTPS addresses and provides compact display strings. Source text, IDs, database rows, API payloads, and JSON schema remain unchanged. Long URL display is capped at 69 characters (56-character prefix, ellipsis, 12-character suffix), applied only when the original exceeds 72 characters. The full source is available on hover and in editing.

Separate domain anchors open addresses in a new tab with `noopener noreferrer`; clicking the item text still edits. L in navigation focuses the first link, Tab moves between links, Enter opens, and Escape returns to the item. Repeated identical URLs produce one opening control per item. Raw HTML and Markdown syntax are not interpreted; invalid URLs and URLs with embedded credentials do not become anchors. There is no remote metadata request or automatic navigation.

`lib/auto-size.ts` is a DOM action that sizes the textarea to its current scroll height on text and width changes. A ResizeObserver schedules width-triggered resizing in the next animation frame to avoid observer delivery loops; teardown disconnects it and cancels pending work. Resize does not mutate the model, history, selection, or save state. The existing editor retains keyboard, composition, and focus handling.

Custom labels, separate comments/notes, and Markdown rendering remain outside M5; they are design options for M7/M9. Detection is a conservative punctuation heuristic rather than a full prose or Markdown parser. Explicit HTTP/HTTPS schemes are required; bare domains are plain text. New tabs suppress the referrer; destination pages are opened only by user action.

## Verification — 2026-10-26

- 34 frontend tests passed, including detection, rejected protocols/credentials, source reconstruction, balanced parentheses, punctuation, and compact display.
- All 31 isolated full-stack browser scenarios passed. The new M5 scenario checks native new-tab activation with a mocked external destination, keyboard link focus/return, literal HTML display, complete textarea source, shrink/grow after edits and viewport resize, undo, focus, no-op indentation, server persistence, reload, and absence of browser runtime errors.
- Existing keyboard/composition, sticky toolbar, draft recovery/conflict, JSON transfer, and ownership-scoped browser workflows passed.
- Mobile edit and navigation screenshots were visually inspected with disposable test content. No user development data was modified by tests.
- `make check` passed: Svelte/TypeScript, Prettier, Rust formatting, and Clippy with warnings denied. The production frontend build passed.

No dependencies, database migrations, or commits were added.
