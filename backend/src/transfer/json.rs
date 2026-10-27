use super::*;
pub(super) fn decode(text: &str) -> Result<Decoded> {
    let value =
        serde_json::from_str(text).map_err(|_| AppError::InvalidImport("Invalid JSON".into()))?;
    Ok(Decoded {
        document: Portable::from_value(value)?,
        warnings: vec![],
    })
}
pub(super) fn encode(document: &Portable) -> Result<Encoded> {
    Ok(Encoded {
        text: serde_json::to_string(&Portable {
            schema_version: 2,
            lists: document.lists.clone(),
        })
        .map_err(|_| AppError::Storage)?,
        extension: "json",
        media_type: "application/json",
        warnings: vec![],
    })
}
