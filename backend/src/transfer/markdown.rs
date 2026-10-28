use super::*;
use crate::model::{Document, Item};
use uuid::Uuid;

fn bad(line: usize, message: &str) -> AppError {
    AppError::InvalidImport(format!("Line {}: {message}", line + 1))
}
fn unescape(text: &str) -> String {
    let mut chars = text.chars().peekable();
    let mut out = String::new();
    while let Some(ch) = chars.next() {
        if ch == '\\' && chars.peek().is_some_and(|c| c.is_ascii_punctuation()) {
            out.push(chars.next().unwrap());
        } else {
            out.push(ch);
        }
    }
    out
}
fn escape(text: &str) -> String {
    let mut out = String::new();
    let trimmed = text.trim_start_matches(' ');
    let padding = text.len() - trimmed.len();
    let list_like = marker(trimmed).is_some();
    for (index, ch) in text.chars().enumerate() {
        if "\\[]*_`<>#".contains(ch)
            || (index == padding && (ch == '-' || ch == '+'))
            || (list_like && (ch == '.' || ch == ')'))
        {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}
fn marker(text: &str) -> Option<&str> {
    for prefix in ["- ", "* ", "+ "] {
        if let Some(rest) = text.strip_prefix(prefix) {
            return Some(rest);
        }
    }
    let digits = text.bytes().take_while(u8::is_ascii_digit).count();
    if digits > 0 {
        let tail = &text[digits..];
        if tail.starts_with(". ") || tail.starts_with(") ") {
            return Some(&tail[2..]);
        }
    }
    None
}
fn task(text: &str) -> Option<(bool, &str)> {
    for (prefix, completed) in [("[ ] ", false), ("[x] ", true), ("[X] ", true)] {
        if let Some(rest) = text.strip_prefix(prefix) {
            return Some((completed, rest));
        }
    }
    // Empty task text is represented by its marker alone.
    match text {
        "[ ]" => Some((false, "")),
        "[x]" | "[X]" => Some((true, "")),
        _ => None,
    }
}
struct Row {
    item: Item,
    indent: usize,
    parent: Option<usize>,
}
pub(super) fn decode(text: &str) -> Result<Decoded> {
    let mut rows: Vec<Row> = vec![];
    let mut stack: Vec<usize> = vec![];
    let mut title = None;
    let mut warnings = vec!["Outline Markdown preserves text, tasks, order and explicit nesting, but not IDs or source list-marker styles. Backslash escapes before punctuation are decoded.".into()];
    let mut paragraph = false;
    let mut separated = true;
    for (line_no, raw) in text.trim_start_matches('\u{feff}').split('\n').enumerate() {
        let raw = raw.strip_suffix('\r').unwrap_or(raw);
        if raw.starts_with('\t')
            || raw
                .chars()
                .take_while(|c| c.is_whitespace())
                .any(|c| c == '\t')
        {
            return Err(bad(line_no, "Use spaces, not tabs, for indentation"));
        }
        let indent = raw.bytes().take_while(|c| *c == b' ').count();
        let body = &raw[indent..];
        if body.is_empty() {
            if indent > 0
                && !paragraph
                && let Some(&last) = stack.last()
                && indent >= rows[last].indent + 2
            {
                let spaces = indent - rows[last].indent - 2;
                rows[last].item.text.push('\n');
                rows[last].item.text.push_str(&" ".repeat(spaces));
            } else {
                separated = true;
                paragraph = false;
            }
            continue;
        }
        if body.starts_with("```") || body.starts_with("~~~") {
            return Err(bad(
                line_no,
                "Fenced code blocks are not supported by outline Markdown; use JSON to preserve arbitrary text",
            ));
        }
        if indent == 0
            && rows.is_empty()
            && title.is_none()
            && let Some(heading) = body.strip_prefix("# ")
        {
            let heading = heading.trim_end();
            let before = heading.trim_end_matches('#');
            let heading = if before.ends_with(' ') {
                before.trim_end()
            } else {
                heading
            };
            title = Some(unescape(heading));
            continue;
        }
        let marked = marker(body);
        if marked.is_none() && indent > 0 {
            let Some(&last) = stack.last() else {
                return Err(bad(line_no, "Indented text has no parent item"));
            };
            if separated || indent < rows[last].indent + 2 {
                return Err(bad(
                    line_no,
                    "Ambiguous continuation; use at least two extra spaces directly after its item",
                ));
            }
            rows[last].item.text.push('\n');
            let continuation = unescape(&raw[rows[last].indent + 2..]);
            rows[last].item.text.push_str(&continuation);
            continue;
        }
        if marked.is_none()
            && indent == 0
            && paragraph
            && !separated
            && task(body).is_none()
            && !body.starts_with('#')
        {
            let last = rows.last_mut().unwrap();
            last.item.text.push('\n');
            last.item.text.push_str(&unescape(body));
            continue;
        }
        let content = marked.unwrap_or(body);
        let checkbox = task(content);
        if marked.is_none() && body.starts_with('#') {
            warnings.push(format!(
                "Line {}: additional heading kept as a root item's literal text.",
                line_no + 1
            ));
        }
        while stack.last().is_some_and(|i| rows[*i].indent >= indent) {
            stack.pop();
        }
        let parent = stack.last().copied();
        if indent > 0 && parent.is_none() {
            return Err(bad(line_no, "Indented list has no explicit parent item"));
        }
        if stack.len() >= crate::validation::MAX_DEPTH {
            return Err(bad(line_no, "Outline exceeds 32 levels"));
        }
        if rows.len() >= crate::validation::MAX_ITEMS {
            return Err(bad(line_no, "Outline exceeds 5000 items"));
        }
        let item = Item {
            id: Uuid::new_v4().to_string(),
            note: String::new(),
            tags: vec![],
            kind: if checkbox.is_some() { "task" } else { "item" }.into(),
            completed: checkbox.is_some_and(|v| v.0),
            text: unescape(checkbox.map_or(content, |v| v.1)),
            children: vec![],
        };
        let index = rows.len();
        rows.push(Row {
            item,
            indent,
            parent,
        });
        stack.push(index);
        paragraph = marked.is_none() && checkbox.is_none();
        separated = false;
    }
    let mut children = vec![Vec::new(); rows.len()];
    let mut roots = vec![];
    for (index, row) in rows.iter().enumerate() {
        if let Some(parent) = row.parent {
            children[parent].push(index);
        } else {
            roots.push(index);
        }
    }
    fn build(index: usize, rows: &[Row], children: &[Vec<usize>]) -> Item {
        let mut item = rows[index].item.clone();
        item.children = children[index]
            .iter()
            .map(|i| build(*i, rows, children))
            .collect();
        item
    }
    Ok(Decoded {
        document: Portable {
            schema_version: 3,
            lists: vec![Document {
                id: Uuid::new_v4().to_string(),
                title: title.unwrap_or_else(|| "Imported outline".into()),
                nodes: roots.iter().map(|i| build(*i, &rows, &children)).collect(),
            }],
        },
        warnings,
    })
}
pub(super) fn encode(document: &Portable) -> Result<Encoded> {
    if document.lists.len() != 1 {
        return Err(AppError::InvalidImport("Markdown exports one list at a time; choose the current list or use JSON for all lists".into()));
    }
    let list = &document.lists[0];
    fn has_tags(items: &[Item]) -> bool {
        items
            .iter()
            .any(|item| !item.tags.is_empty() || has_tags(&item.children))
    }
    if has_tags(&list.nodes) {
        return Err(AppError::InvalidImport("This list contains tags. Export JSON to preserve them; outline Markdown does not represent tags.".into()));
    }
    fn has_notes(items: &[Item]) -> bool {
        items
            .iter()
            .any(|item| !item.note.is_empty() || has_notes(&item.children))
    }
    if has_notes(&list.nodes) {
        return Err(AppError::InvalidImport("This list contains item notes. Export JSON to preserve them; outline Markdown does not represent separate notes.".into()));
    }
    fn has_unsupported_whitespace(items: &[Item]) -> bool {
        items.iter().any(|item| {
            item.text.contains('\r')
                || item
                    .text
                    .lines()
                    .any(|line| line.trim_start_matches(' ').starts_with('\t'))
                || has_unsupported_whitespace(&item.children)
        })
    }
    if has_unsupported_whitespace(&list.nodes) {
        return Err(AppError::InvalidImport(
            "Markdown cannot preserve literal carriage returns or leading tab indentation; use JSON".into(),
        ));
    }
    if list.title.contains(['\n', '\r']) || list.title.trim() != list.title {
        return Err(AppError::InvalidImport(
            "Markdown requires a single-line title without surrounding whitespace; use JSON".into(),
        ));
    }
    let mut text = format!("# {}\n\n", escape(&list.title));
    fn write(items: &[Item], depth: usize, out: &mut String) {
        for item in items {
            let pad = "  ".repeat(depth);
            let mut lines = item.text.split('\n');
            let checkbox = if item.kind == "task" {
                if item.completed { "[x] " } else { "[ ] " }
            } else {
                ""
            };
            out.push_str(&format!(
                "{pad}- {checkbox}{}\n",
                escape(lines.next().unwrap_or(""))
            ));
            for line in lines {
                out.push_str(&format!("{pad}  {}\n", escape(line)));
            }
            write(&item.children, depth + 1, out);
        }
    }
    write(&list.nodes, 0, &mut text);
    Ok(Encoded { text, extension: "md", media_type: "text/markdown;charset=utf-8", warnings: vec!["Markdown omits IDs and uses normalized bullets and task markers. JSON preserves the full portable schema.".into()] })
}
