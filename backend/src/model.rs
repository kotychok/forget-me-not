use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Item {
    pub id: String,
    pub kind: String,
    pub text: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub note: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(
        default,
        rename = "dueDate",
        deserialize_with = "deserialize_due_date",
        skip_serializing_if = "Option::is_none"
    )]
    pub due_date: Option<String>,
    pub completed: bool,
    pub children: Vec<Item>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Document {
    pub id: String,
    pub title: String,
    pub nodes: Vec<Item>,
}
#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ListDocument {
    pub id: String,
    pub title: String,
    pub revision: i64,
    pub nodes: Vec<Item>,
}
#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ListSummary {
    pub id: String,
    pub title: String,
    pub revision: i64,
    pub position: i64,
    pub item_count: i64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateList {
    pub title: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveList {
    pub base_revision: i64,
    pub document: Document,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeleteList {
    pub base_revision: i64,
}

#[derive(Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ClientIdentity {
    pub server_id: String,
    pub owner_id: String,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OutlineView {
    pub collapsed_item_ids: Vec<String>,
    pub revision: i64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ViewChange {
    pub item_id: String,
    pub collapsed: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PatchView {
    pub base_revision: i64,
    pub changes: Vec<ViewChange>,
}

fn deserialize_due_date<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<Option<String>, D::Error> {
    String::deserialize(deserializer).map(Some)
}
