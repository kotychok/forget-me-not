//! Versioned, transport-independent incremental packet validation and tree simulation.
use crate::{
    error::{AppError, Result},
    model::{Document, Item},
    validation::{flatten, valid_date, valid_id, validate_tags},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};
pub(crate) fn fail(code: &'static str, message: &'static str) -> AppError {
    AppError::Protocol(code, message)
}
fn bad() -> AppError {
    fail("invalid_batch", "Invalid incremental packet")
}
fn reference() -> AppError {
    fail(
        "invalid_reference",
        "Referenced item is unavailable in this list",
    )
}
fn structure() -> AppError {
    fail("invalid_structure", "Invalid branch placement")
}
fn limit() -> AppError {
    fail(
        "limit_exceeded",
        "Incremental save exceeds its work or document limits",
    )
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Batch {
    pub protocol_version: u64,
    pub operation_id: String,
    pub base_revision: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub ops: Vec<Op>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "lowercase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Op {
    Update {
        item_id: String,
        changes: BTreeMap<String, Value>,
    },
    Create {
        item: NewItem,
        parent_id: Option<String>,
        after_id: Option<String>,
    },
    Move {
        item_id: String,
        parent_id: Option<String>,
        after_id: Option<String>,
    },
    Remove {
        item_id: String,
    },
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NewItem {
    pub id: String,
    pub kind: String,
    pub text: String,
    pub completed: bool,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub due_date: Option<String>,
}
impl NewItem {
    fn node(&self) -> Item {
        Item {
            id: self.id.clone(),
            kind: self.kind.clone(),
            text: self.text.clone(),
            completed: self.completed,
            note: self.note.clone(),
            tags: self.tags.clone(),
            due_date: self.due_date.clone(),
            children: vec![],
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Acknowledgement {
    pub protocol_version: u8,
    pub operation_id: String,
    pub revision: i64,
}

// Reject duplicate keys before typed decoding/canonicalization. Protocol numbers are integers only.
struct Unique(Value);
impl<'de> Deserialize<'de> for Unique {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> std::result::Result<Self, D::Error> {
        struct Visitor;
        impl<'de> serde::de::Visitor<'de> for Visitor {
            type Value = Unique;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("unambiguous JSON")
            }
            fn visit_bool<E: serde::de::Error>(self, v: bool) -> std::result::Result<Unique, E> {
                Ok(Unique(v.into()))
            }
            fn visit_i64<E: serde::de::Error>(self, v: i64) -> std::result::Result<Unique, E> {
                Ok(Unique(v.into()))
            }
            fn visit_u64<E: serde::de::Error>(self, v: u64) -> std::result::Result<Unique, E> {
                Ok(Unique(v.into()))
            }
            fn visit_str<E: serde::de::Error>(self, v: &str) -> std::result::Result<Unique, E> {
                Ok(Unique(v.into()))
            }
            fn visit_string<E: serde::de::Error>(
                self,
                v: String,
            ) -> std::result::Result<Unique, E> {
                Ok(Unique(v.into()))
            }
            fn visit_unit<E: serde::de::Error>(self) -> std::result::Result<Unique, E> {
                Ok(Unique(Value::Null))
            }
            fn visit_none<E: serde::de::Error>(self) -> std::result::Result<Unique, E> {
                Ok(Unique(Value::Null))
            }
            fn visit_seq<A: serde::de::SeqAccess<'de>>(
                self,
                mut a: A,
            ) -> std::result::Result<Unique, A::Error> {
                let mut values = vec![];
                while let Some(Unique(v)) = a.next_element()? {
                    values.push(v);
                }
                Ok(Unique(values.into()))
            }
            fn visit_map<A: serde::de::MapAccess<'de>>(
                self,
                mut a: A,
            ) -> std::result::Result<Unique, A::Error> {
                let mut values = serde_json::Map::new();
                while let Some((key, Unique(v))) = a.next_entry::<String, Unique>()? {
                    if values.insert(key, v).is_some() {
                        return Err(serde::de::Error::custom("Duplicate JSON key"));
                    }
                }
                Ok(Unique(Value::Object(values)))
            }
        }
        d.deserialize_any(Visitor)
    }
}
fn fields(item: &Item) -> Result<()> {
    if !matches!(item.kind.as_str(), "item" | "task") {
        return Err(bad());
    }
    if item.text.len() > 32768 || item.note.len() > 65536 {
        return Err(limit());
    }
    if item.tags.len() > 12 || item.tags.iter().any(|tag| tag.chars().count() > 40) {
        return Err(limit());
    }
    validate_tags(&item.tags).map_err(|_| bad())?;
    if item
        .due_date
        .as_deref()
        .is_some_and(|date| !valid_date(date))
    {
        return Err(bad());
    }
    Ok(())
}
fn update(item: &mut Item, changes: &BTreeMap<String, Value>) -> Result<()> {
    if changes.is_empty() {
        return Err(bad());
    }
    for (key, value) in changes {
        match key.as_str() {
            "text" => item.text = value.as_str().ok_or_else(bad)?.into(),
            "note" => item.note = value.as_str().ok_or_else(bad)?.into(),
            "kind" => item.kind = value.as_str().ok_or_else(bad)?.into(),
            "completed" => item.completed = value.as_bool().ok_or_else(bad)?,
            "tags" => item.tags = serde_json::from_value(value.clone()).map_err(|_| bad())?,
            "dueDate" => {
                item.due_date = if value.is_null() {
                    None
                } else {
                    Some(value.as_str().ok_or_else(bad)?.into())
                }
            }
            _ => return Err(bad()),
        }
    }
    fields(item)
}
fn find<'a>(nodes: &'a [Item], id: &str) -> Option<&'a Item> {
    for n in nodes {
        if n.id == id {
            return Some(n);
        }
        if let Some(v) = find(&n.children, id) {
            return Some(v);
        }
    }
    None
}
fn find_mut<'a>(nodes: &'a mut [Item], id: &str) -> Option<&'a mut Item> {
    for n in nodes {
        if n.id == id {
            return Some(n);
        }
        if let Some(v) = find_mut(&mut n.children, id) {
            return Some(v);
        }
    }
    None
}
fn detach(nodes: &mut Vec<Item>, id: &str) -> Option<Item> {
    if let Some(i) = nodes.iter().position(|n| n.id == id) {
        return Some(nodes.remove(i));
    }
    for n in nodes {
        if let Some(v) = detach(&mut n.children, id) {
            return Some(v);
        }
    }
    None
}
fn insert(
    nodes: &mut Vec<Item>,
    item: Item,
    parent: &Option<String>,
    after: &Option<String>,
) -> Result<()> {
    if after.as_deref() == Some(&item.id) || parent.as_deref() == Some(&item.id) {
        return Err(structure());
    }
    if let Some(anchor) = after
        && find(nodes, anchor).is_none()
    {
        return Err(reference());
    }
    let group = match parent {
        Some(id) => &mut find_mut(nodes, id).ok_or_else(reference)?.children,
        None => nodes,
    };
    let at = match after {
        Some(id) => {
            group
                .iter()
                .position(|n| &n.id == id)
                .ok_or_else(structure)?
                + 1
        }
        None => 0,
    };
    group.insert(at, item);
    Ok(())
}
fn bounds(nodes: &[Item]) -> Result<usize> {
    let mut pending: Vec<_> = nodes.iter().map(|n| (n, 1)).collect();
    let mut count = 0;
    while let Some((n, depth)) = pending.pop() {
        count += 1;
        if count > 10000 || depth > 64 {
            return Err(limit());
        }
        pending.extend(n.children.iter().map(|n| (n, depth + 1)));
    }
    Ok(count)
}
impl Batch {
    pub fn decode(bytes: &[u8]) -> Result<Self> {
        let Unique(raw) = serde_json::from_slice::<Unique>(bytes).map_err(|error| {
            if error.is_syntax() || error.is_eof() {
                fail("invalid_json", "Malformed JSON")
            } else {
                bad()
            }
        })?;
        if raw.get("title").is_some_and(Value::is_null) {
            return Err(bad());
        }
        if let Some(ops) = raw.get("ops").and_then(Value::as_array) {
            for op in ops {
                if matches!(
                    op.get("type").and_then(Value::as_str),
                    Some("create" | "move")
                ) && (op.get("parentId").is_none() || op.get("afterId").is_none())
                {
                    return Err(bad());
                }
            }
        }
        let batch: Self = serde_json::from_value(raw).map_err(|_| bad())?;
        batch.validate()?;
        Ok(batch)
    }
    pub fn validate(&self) -> Result<()> {
        if self.protocol_version != 1 {
            return Err(fail(
                "unsupported_save_version",
                "Unsupported incremental save version",
            ));
        }
        if !valid_id(&self.operation_id)
            || self.base_revision < 0
            || self.base_revision > 9_007_199_254_740_990
            || self.ops.is_empty() && self.title.is_none()
        {
            return Err(bad());
        }
        if self.ops.len() > 10000 {
            return Err(limit());
        }
        if let Some(title) = &self.title {
            crate::validation::validate_title(title).map_err(|_| bad())?;
        }
        let mut created = HashSet::new();
        for op in &self.ops {
            let (id, parent, after) = match op {
                Op::Update { item_id, changes } => {
                    let mut item = Item {
                        id: item_id.clone(),
                        kind: "item".into(),
                        text: String::new(),
                        note: String::new(),
                        tags: vec![],
                        due_date: None,
                        completed: false,
                        children: vec![],
                    };
                    update(&mut item, changes)?;
                    (item_id, None, None)
                }
                Op::Create {
                    item,
                    parent_id,
                    after_id,
                } => {
                    fields(&item.node())?;
                    if !created.insert(&item.id) {
                        return Err(bad());
                    }
                    (&item.id, parent_id.as_ref(), after_id.as_ref())
                }
                Op::Move {
                    item_id,
                    parent_id,
                    after_id,
                } => (item_id, parent_id.as_ref(), after_id.as_ref()),
                Op::Remove { item_id } => (item_id, None, None),
            };
            if !valid_id(id)
                || parent.is_some_and(|id| !valid_id(id))
                || after.is_some_and(|id| !valid_id(id))
            {
                return Err(bad());
            }
        }
        Ok(())
    }
    pub fn create_ids(&self) -> Vec<&str> {
        self.ops
            .iter()
            .filter_map(|op| match op {
                Op::Create { item, .. } => Some(item.id.as_str()),
                _ => None,
            })
            .collect()
    }
    pub fn hash(&self, list: &str) -> Result<Vec<u8>> {
        fn sort(value: &mut Value) {
            match value {
                Value::Object(map) => {
                    for v in map.values_mut() {
                        sort(v);
                    }
                    map.sort_keys();
                }
                Value::Array(values) => values.iter_mut().for_each(sort),
                _ => {}
            }
        }
        let mut value = serde_json::json!({"listId":list,"packet":self});
        sort(&mut value);
        Ok(Sha256::digest(serde_json::to_vec(&value).map_err(|_| AppError::Storage)?).to_vec())
    }
    pub fn apply(&self, mut doc: Document) -> Result<Document> {
        self.validate()?;
        let count = bounds(&doc.nodes)?;
        let creates = self.create_ids();
        if (count + creates.len()).saturating_mul(self.ops.len().max(1)) > 2_000_000 {
            return Err(limit());
        }
        for id in creates {
            if find(&doc.nodes, id).is_some() {
                return Err(bad());
            }
        }
        for op in &self.ops {
            match op {
                Op::Update { item_id, changes } => update(
                    find_mut(&mut doc.nodes, item_id).ok_or_else(reference)?,
                    changes,
                )?,
                Op::Create {
                    item,
                    parent_id,
                    after_id,
                } => insert(&mut doc.nodes, item.node(), parent_id, after_id)?,
                Op::Move {
                    item_id,
                    parent_id,
                    after_id,
                } => {
                    let item = find(&doc.nodes, item_id).ok_or_else(reference)?;
                    if parent_id
                        .as_ref()
                        .is_some_and(|id| id == item_id || find(&item.children, id).is_some())
                    {
                        return Err(structure());
                    }
                    let item = detach(&mut doc.nodes, item_id).ok_or_else(reference)?;
                    insert(&mut doc.nodes, item, parent_id, after_id)?;
                }
                Op::Remove { item_id } => {
                    detach(&mut doc.nodes, item_id).ok_or_else(reference)?;
                }
            }
            bounds(&doc.nodes)?;
        }
        if let Some(title) = &self.title {
            doc.title = title.clone();
        }
        flatten(&doc).map_err(|error| match error {
            AppError::Invalid(message) if message.contains("exceeds") => limit(),
            _ => bad(),
        })?;
        if serde_json::to_vec(
            &serde_json::json!({"baseRevision":self.base_revision,"document":doc}),
        )
        .map_err(|_| AppError::Storage)?
        .len()
            > 1024 * 1024
        {
            return Err(limit());
        }
        Ok(doc)
    }
}
