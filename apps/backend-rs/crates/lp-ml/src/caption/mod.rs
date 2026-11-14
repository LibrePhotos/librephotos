//! Image captions (`service/image_captioning`, sidecar :8007): LFM2.5-VL-450M
//! (vision encoder + embed tokens + merged decoder, q4 weights, fp32
//! activations), greedy decoding. Contract: `POST /generate-caption
//! {image_path, prompt?}` -> `{caption}`, or `{error}` with a failure status.

mod inprocess;
pub mod lfm2_vl;

pub use inprocess::InProcess;

use async_trait::async_trait;
use lp_sidecars::{SidecarError, Sidecars};

#[async_trait]
pub trait CaptionApi: Send + Sync {
    async fn generate_caption(
        &self,
        image_path: &str,
        prompt: Option<&str>,
    ) -> Result<String, SidecarError>;
}

#[async_trait]
impl CaptionApi for Sidecars {
    async fn generate_caption(
        &self,
        image_path: &str,
        prompt: Option<&str>,
    ) -> Result<String, SidecarError> {
        Sidecars::generate_caption(self, image_path, prompt).await
    }
}
