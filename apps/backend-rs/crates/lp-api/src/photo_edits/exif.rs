//! `api.metadata.reader.get_metadata` / `api.metadata.writer` through the
//! in-process ExifTool pool (`state.exif`).

use std::path::Path;

use lp_exif::ExifPool;
use serde_json::Value;

/// `api.metadata.writer.read_orientation`: the file's own EXIF Orientation
/// (1 when absent), `None` when it cannot be read.
pub async fn read_orientation(exif: &ExifPool, media_file: &str) -> Option<i64> {
    exif.read_orientation(Path::new(media_file)).await
}

/// `api.metadata.writer.write_metadata(media_file, {tag: value}, use_sidecar)`.
pub async fn write_tag(
    exif: &ExifPool,
    media_file: &str,
    tag: &str,
    value: i64,
    use_sidecar: bool,
) -> anyhow::Result<()> {
    exif.write_metadata(
        Path::new(media_file),
        &[(tag.to_string(), Value::from(value))],
        use_sidecar,
    )
    .await?;
    Ok(())
}

/// One value per tag (None when absent); a later file wins, as in the exif
/// sidecar's `highest_priority_values`.
pub async fn get_metadata(
    exif: &ExifPool,
    media_file: &str,
    tags: &[String],
) -> anyhow::Result<Vec<Option<Value>>> {
    Ok(exif
        .get_metadata(Path::new(media_file), tags, true, false)
        .await?)
}
