use crate::{
    error::{AppError, Result},
    model::Document,
    validation::flatten,
};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const MAX_FILE_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_LISTS: usize = 100;
pub const MAX_TOTAL_ITEMS: usize = 10_000;
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Portable {
    pub schema_version: u32,
    pub lists: Vec<Document>,
}
fn invalid(message: String) -> AppError {
    AppError::InvalidImport(message)
}
impl Portable {
    pub fn from_value(value: serde_json::Value) -> Result<Self> {
        let document: Self = serde_path_to_error::deserialize(value)
            .map_err(|error| invalid(format!("$.{}: {}", error.path(), error.inner())))?;
        document.validate()?;
        Ok(document)
    }
    pub fn validate(&self) -> Result<()> {
        if self.schema_version != 1 {
            return Err(invalid(
                "$.schemaVersion: only version 1 is supported".into(),
            ));
        }
        if self.lists.is_empty() || self.lists.len() > MAX_LISTS {
            return Err(invalid("$.lists: expected 1–100 lists".into()));
        }
        let mut lists = HashSet::new();
        let mut items = HashSet::new();
        let mut total = 0;
        for (index, document) in self.lists.iter().enumerate() {
            let path = format!("$.lists[{index}]");
            if !lists.insert(&document.id) {
                return Err(invalid(format!("{path}.id: duplicate list ID")));
            }
            let flat = flatten(document).map_err(|error| match error {
                AppError::Invalid(message) => invalid(format!("{path}: {message}")),
                other => other,
            })?;
            total += flat.len();
            if total > MAX_TOTAL_ITEMS {
                return Err(invalid(format!("{path}: file exceeds 10000 items")));
            }
            for item in flat {
                if !items.insert(item.id) {
                    return Err(invalid(format!("{path}: duplicate item ID across lists")));
                }
            }
            let snapshot = serde_json::json!({"baseRevision":0,"document":document});
            if serde_json::to_vec(&snapshot)
                .map_err(|_| AppError::Storage)?
                .len()
                > 1024 * 1024
            {
                return Err(invalid(format!(
                    "{path}: list exceeds the 1 MiB save limit"
                )));
            }
        }
        if serde_json::to_vec(self)
            .map_err(|_| AppError::Storage)?
            .len()
            > MAX_FILE_BYTES
        {
            return Err(invalid(
                "$: file exceeds 8 MiB; export individual lists".into(),
            ));
        }
        Ok(())
    }
}
