use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Item {
    pub id: String,
    pub kind: String,
    pub text: String,
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
