//! RAW rendering (`service/thumbnail`, sidecar :8003): rawpy/LibRaw
//! postprocess, resized to `height` and written as WebP to `destination`.
//! Contract: `POST / {source, destination, height}` -> `{thumbnail: path}`.
//! Called from `lp-ingest`'s renderer on a blocking thread (via
//! `Handle::block_on`), for RAW files libvips cannot load.

mod inprocess;

pub use inprocess::InProcess;

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
