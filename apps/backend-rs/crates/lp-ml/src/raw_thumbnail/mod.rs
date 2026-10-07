//! RAW rendering (`service/thumbnail`, sidecar :8003): rawpy/LibRaw
//! postprocess, resized to `height` and written as WebP to `destination`.
//! Contract: `POST / {source, destination, height}` -> `{thumbnail: path}`.
//! Called from `lp-ingest`'s renderer on a blocking thread (via
//! `Handle::block_on`), for RAW files without a usable embedded preview.
//!
//! [`raw_preview`] is `image_decoding.raw_preview` (Django runs it in-process
//! before asking the service), used whichever backend renders.

mod ahd;
mod develop;
mod inprocess;
mod preview;
mod resize;

pub use develop::{Developed, develop_file};
pub use inprocess::InProcess;
pub use preview::{fallback_preview, raw_preview};
pub use resize::{rotate_exif, shrink_to_height, webp_save};

use std::path::Path;

use async_trait::async_trait;
use lp_sidecars::{SidecarError, Sidecars};

#[async_trait]
pub trait RawThumbnailApi: Send + Sync {
    /// Render `source` to `destination`; returns the written path.
    async fn render_thumbnail(
        &self,
        source: &str,
        destination: &str,
        height: u32,
    ) -> Result<String, SidecarError>;
}

#[async_trait]
impl RawThumbnailApi for Sidecars {
    async fn render_thumbnail(
        &self,
        source: &str,
        destination: &str,
        height: u32,
    ) -> Result<String, SidecarError> {
        Sidecars::render_thumbnail(self, source, destination, height).await
    }
}

/// The service's `render_raw` up to the pixels: the sensor data developed
/// (half size when that still covers `height`), shrunk to `height`.
pub fn render_raw_image(source: &Path, height: u32) -> anyhow::Result<image::RgbImage> {
    let dev = develop_file(source, height)?;
    Ok(shrink_to_height(&dev.image, height))
}

/// `render_raw`: [`render_raw_image`] saved as WebP Q95 (default effort).
pub fn render_raw(source: &Path, destination: &Path, height: u32) -> anyhow::Result<()> {
    let img = render_raw_image(source, height)?;
    webp_save(&img, destination, 95.0, None)
}
