# Markdown display — M9

Item text is original Markdown source, not a rich-text document. The default Markdown preview checkbox in the item toolbar changes presentation only. Uncheck it for literal source with compact URLs. This preference is local to the current editor pane, not a saved cross-device setting. Click or F2 always edits the complete original string in the existing growing textarea; Escape returns to navigation. No renderer writes to history, autosave, search, JSON v3 or the database.

Supported display: bold, emphasis, strike-through, inline/fenced/indented code, paragraphs and line breaks, headings, quotations, unordered/ordered lists, static task markers, rules, labelled/reference links and bare HTTP/HTTPS URLs. Lists inside text are formatting only, not editable tree children or task checkboxes. Unsupported token types such as tables show escaped source. HTML stays literal. Images show `[image: alt]` without loading any image or fetching metadata.

Item preview remains inside the click-to-edit button. Links are styled there but opened using separate labelled controls below the item. L focuses the first control and Escape returns to the item. HTTP/HTTPS only: reject credentials, whitespace/control characters, backslashes, relative and other-scheme URLs. Opening is explicit, in a new tab with `noopener noreferrer`. Long bare URLs stay compact; full source is available in editing or the URL tooltip. NoteDialog offers a separate preview of its unapplied draft, with native checked links; Apply/Cancel semantics remain unchanged.

Search matches original source. Visible text fragments can be highlighted; a query containing hidden Markdown delimiters or spanning formatting boundaries may have no inline highlight. The row match indication and Source view/editing still expose that match. Filtering and remembered collapse state remain separate.

## Boundaries and limits

Marked 18.1.2 supplies lexer tokens; entities 8.1.0 decodes character entities into text. No generated HTML is used, and Svelte renders only known escaped text/elements. Code and raw HTML source are not entity-decoded. Existing item/note byte limits apply. Conversion limits are 2,000 tokens/nodes and depth 24; complex input or parse errors fall back to full escaped source with plain safe-link controls, never truncation. The lexer runs before conversion limits; these are display guards, not a hard CPU timeout. Plain items skip the lexer. A bounded LRU caches at most 128 complex strings and 256 Ki characters of source; this is not a persistent store.

Dependencies: [Marked lexer API](https://marked.js.org/using_pro), [Marked security guidance](https://github.com/markedjs/marked), [entities](https://github.com/fb55/entities). Future syntax additions must preserve the allowlist and explicit remote-resource policy. Syntax colouring, HTML, embedded media, tables, rich-text editing and persisted preview preferences are outside M9.
