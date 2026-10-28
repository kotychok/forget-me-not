use crate::{
    error::{Result, invalid},
    model::{Document, Item},
};
use std::collections::HashSet;
use uuid::Uuid;
pub const MAX_ITEMS: usize = 5000;
pub const MAX_DEPTH: usize = 32;

fn valid_id(id: &str) -> bool {
    Uuid::parse_str(id).is_ok_and(|uuid| {
        uuid.get_version_num() == 4
            && uuid.get_variant() == uuid::Variant::RFC4122
            && uuid.to_string() == id
    })
}

#[derive(Debug)]
pub(crate) struct FlatItem {
    pub id: String,
    pub parent_id: Option<String>,
    pub position: i64,
    pub kind: String,
    pub text: String,
    pub note: String,
    pub tags: String,
    pub due_date: Option<String>,
    pub completed: bool,
}

pub(crate) fn flatten(document: &Document) -> Result<Vec<FlatItem>> {
    if !valid_id(&document.id) {
        return Err(invalid("Invalid list ID"));
    }
    validate_title(&document.title)?;
    let mut output = Vec::new();
    let mut seen = HashSet::new();
    let mut pending: Vec<(&Item, Option<&str>, usize, usize)> = document
        .nodes
        .iter()
        .enumerate()
        .map(|(i, n)| (n, None, i, 1))
        .collect();
    while let Some((item, parent, position, depth)) = pending.pop() {
        if depth > MAX_DEPTH || output.len() >= MAX_ITEMS {
            return Err(invalid("List exceeds 5000 items or 32 levels"));
        }
        if !valid_id(&item.id) || !seen.insert(item.id.clone()) {
            return Err(invalid("Item IDs must be unique canonical UUIDv4 values"));
        }
        if !matches!(item.kind.as_str(), "item" | "task") || (item.kind == "item" && item.completed)
        {
            return Err(invalid("Invalid item kind or completion"));
        }
        if item.text.len() > 32768 {
            return Err(invalid("Item text exceeds 32 KiB"));
        }
        if item.note.len() > 65536 {
            return Err(invalid("Item note exceeds 64 KiB"));
        }
        validate_tags(&item.tags)?;
        if item
            .due_date
            .as_deref()
            .is_some_and(|date| !valid_date(date))
        {
            return Err(invalid(
                "Due date must be a real calendar date YYYY-MM-DD (0001–9999)",
            ));
        }
        output.push(FlatItem {
            id: item.id.clone(),
            parent_id: parent.map(str::to_owned),
            position: position as i64,
            kind: item.kind.clone(),
            text: item.text.clone(),
            note: item.note.clone(),
            tags: serde_json::to_string(&item.tags).map_err(|_| invalid("Invalid tags"))?,
            due_date: item.due_date.clone(),
            completed: item.completed,
        });
        pending.extend(
            item.children
                .iter()
                .enumerate()
                .map(|(i, child)| (child, Some(item.id.as_str()), i, depth + 1)),
        );
    }
    Ok(output)
}
pub(crate) fn validate_title(title: &str) -> Result<()> {
    if title.trim().is_empty() || title.chars().count() > 200 {
        return Err(invalid("Title must contain 1–200 characters"));
    }
    Ok(())
}

pub(crate) fn validate_tags(tags: &[String]) -> Result<()> {
    if tags.len() > 12 {
        return Err(invalid("An item can have at most 12 tags"));
    }
    let mut seen = HashSet::new();
    for tag in tags {
        if tag.is_empty()
            || tag.chars().count() > 40
            || tag.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}') != tag
            || tag.chars().any(|c| c.is_control() || c == ',')
        {
            return Err(invalid(
                "Tags must contain 1–40 characters without surrounding whitespace, commas or control characters",
            ));
        }
        if !seen.insert(tag) {
            return Err(invalid("Duplicate tag names are not allowed"));
        }
    }
    Ok(())
}

/// Date-only Gregorian validation, independent of server timezone.
fn valid_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 10
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || !bytes
            .iter()
            .enumerate()
            .all(|(i, ch)| i == 4 || i == 7 || ch.is_ascii_digit())
    {
        return false;
    }
    let year: u32 = value[..4].parse().unwrap_or(0);
    let month: usize = value[5..7].parse().unwrap_or(0);
    let day: u32 = value[8..].parse().unwrap_or(0);
    let leap = year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400));
    year >= 1
        && (1..=12).contains(&month)
        && day >= 1
        && day
            <= [
                31,
                if leap { 29 } else { 28 },
                31,
                30,
                31,
                30,
                31,
                31,
                30,
                31,
                30,
                31,
            ][month - 1]
}
