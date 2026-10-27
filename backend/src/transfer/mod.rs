//! Pure, compiled format adapters. Storage and HTTP remain outside this module.
mod json;
mod markdown;
use crate::{
    error::{AppError, Result},
    portable::{MAX_FILE_BYTES, Portable},
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Format {
    Json,
    Markdown,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Decoded {
    pub document: Portable,
    pub warnings: Vec<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Encoded {
    pub text: String,
    pub extension: &'static str,
    pub media_type: &'static str,
    pub warnings: Vec<String>,
}
pub fn decode(format: Format, text: &str) -> Result<Decoded> {
    if text.len() > MAX_FILE_BYTES {
        return Err(AppError::InvalidImport("File exceeds 8 MiB".into()));
    }
    let result = match format {
        Format::Json => json::decode(text),
        Format::Markdown => markdown::decode(text),
    }?;
    result.document.validate()?;
    Ok(result)
}
pub fn encode(format: Format, document: &Portable) -> Result<Encoded> {
    document.validate()?;
    let result = match format {
        Format::Json => json::encode(document),
        Format::Markdown => markdown::encode(document),
    }?;
    if result.text.len() > MAX_FILE_BYTES {
        return Err(AppError::InvalidImport("Export exceeds 8 MiB".into()));
    }
    Ok(result)
}
