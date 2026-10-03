//! Zero-shot scene tags (`service/tags`, sidecar :8011): MobileCLIP-S2
//! (softmax over `tags.txt`, keeps scores of at least 0.02) or SigLIP 2
//! (raw cosine, at least 0.05), at most 10 tags. Contract: `POST /generate-tags {image_path,
//! confidence, tagging_model}` -> `{"tags": {...}}` (stored as-is under
//! `captions_json[<model>]`); an unknown model is a 400.

mod inprocess;
pub mod npy;
pub mod spm;
pub mod tagger;

pub use inprocess::InProcess;

use async_trait::async_trait;
use lp_sidecars::{SidecarError, Sidecars};
use serde_json::Value;

#[async_trait]
pub trait TagsApi: Send + Sync {
    /// The whole JSON reply (`{"tags": {...}}`).
    async fn generate_tags(
        &self,
        image_path: &str,
        confidence: f64,
        tagging_model: &str,
    ) -> Result<Value, SidecarError>;
}

#[async_trait]
impl TagsApi for Sidecars {
    async fn generate_tags(
        &self,
        image_path: &str,
        confidence: f64,
        tagging_model: &str,
    ) -> Result<Value, SidecarError> {
        Sidecars::generate_tags(self, image_path, confidence, tagging_model).await
    }
}
