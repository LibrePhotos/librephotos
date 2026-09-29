//! The two metadata reads the tasks need (face regions, GPS), through the
//! in-process ExifTool pool with the exif sidecar's semantics: every existing
//! XMP sidecar and the media file, later files overriding earlier ones. No
//! ExifTool installed reads as "no metadata".

use std::path::Path;

use lp_exif::{ExifError, ExifPool};
use serde_json::Value;

#[derive(Debug, thiserror::Error)]
#[error("exif service could not read the metadata of {file}: {message}")]
pub struct MetadataError {
    pub file: String,
    pub message: String,
}

/// `get_metadata(media, tags, try_sidecar=True, struct=...)`: one value per
/// tag (`None` when absent). `Ok(None)` when ExifTool is not installed.
pub async fn get_tags(
    exif: &ExifPool,
    media: &str,
    tags: &[&str],
    structured: bool,
) -> Result<Option<Vec<Option<Value>>>, MetadataError> {
    let tags: Vec<String> = tags.iter().map(|t| t.to_string()).collect();
    match exif
        .get_metadata(Path::new(media), &tags, true, structured)
        .await
    {
        Ok(values) => Ok(Some(values)),
        // get_metadata folds a failed spawn into `Read`.
        Err(ExifError::Read { detail, .. }) if detail.contains("could not start exiftool") => {
            tracing::debug!(%detail, "exiftool not available");
            Ok(None)
        }
        Err(e) => Err(MetadataError {
            file: media.to_string(),
            message: e.to_string(),
        }),
    }
}
