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
        output.push(FlatItem {
            id: item.id.clone(),
            parent_id: parent.map(str::to_owned),
            position: position as i64,
            kind: item.kind.clone(),
            text: item.text.clone(),
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
