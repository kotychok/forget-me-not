# M9 implementation record

Authorized after the user verified and committed M8 on 2026-10-28. Implementation defaults await user review.

- Add a pure, bounded Markdown token adapter and shared checked URL policy.
- Render the allowlist through Svelte components; never inject HTML or load images.
- Preserve item click/F2 editing and separate keyboard-accessible link opening.
- Add pane-local preview toggle and optional note draft preview.
- Keep source/history/storage/search/JSON contracts unchanged; no migration.

Contract and limitations: [Markdown display](../markdown-display.md).

Verification: frontend type/format checks and 57 unit tests pass, including syntax, entity/escape boundaries, unsafe URLs, literal HTML/images and bounded fallback. Browser verification: 47 distinct scenarios passed across the regression run and the retained Markdown-transfer/scale run. The synthetic 5,000-item load/edit/undo/save/search/reload scenario took 8.4 seconds on this machine (not a performance guarantee). The new scenario checks format/source switching, unchanged save/reload source, undo/focus, note draft cancellation, literal HTML, absent image/HTML elements, safe labelled controls and no remote requests. Existing JSON transfer tests preserve Markdown source. Mobile preview was inspected at 390px. `make check`, frontend production build and `git diff --check` pass. No backend/schema change or new migration; backend Clippy/fmt passed through `make check`.
