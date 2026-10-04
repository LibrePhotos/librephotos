//! CLIP ViT-B/32 embeddings (`service/clip_embeddings`, sidecar :8006):
//! image embeddings for the similarity index, text embeddings for search.
//! Contract: `POST /clip-embeddings {imgs, model}` -> `{imgs_emb, magnitudes}`
//! (one slot per path, `null` where unreadable), `POST /query-embeddings
//! {query, model}` -> `{emb, magnitude}`. `model` is the model directory.

pub mod inprocess;

pub use inprocess::{Clip, InProcess, prepare_image};

use std::path::Path;

use async_trait::async_trait;
use lp_sidecars::{ClipEmbeddings, QueryEmbedding, SidecarError, Sidecars};

/// The model behind semantic search and similar photos (site setting
/// `SEMANTIC_SEARCH_MODEL`). Both produce 512-d embeddings, stored
/// unnormalised with their magnitude; the inner-product thresholds follow
/// the model because the raw scales differ (ViT-B/32: image and text norms
/// ~10; MobileCLIP-S2: image ~1, text ~9.5).
///
/// MobileCLIP-S2 (the default) is also the default tagging model: when both
/// settings name it, one image-tower run per photo yields the tags and the
/// stored embedding (`tags.generate` writes both), and the 608 MB ViT-B/32
/// is never loaded. Embeddings of the other model are recognised by their
/// magnitude ([`SemanticModel::fits_magnitude`]) and recomputed
/// (`lp_tasks::clip::reembed_mismatched`, at startup and after a settings
/// change), so an existing library re-embeds once after the switch.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SemanticModel {
    ClipVitB32,
    MobileClipS2,
}

impl SemanticModel {
    pub const DEFAULT: SemanticModel = SemanticModel::MobileClipS2;

    pub fn from_name(name: &str) -> Option<SemanticModel> {
        match name.trim() {
            "clip_vit_b32" => Some(SemanticModel::ClipVitB32),
            "" | "mobileclip_s2" => Some(SemanticModel::MobileClipS2),
            _ => None,
        }
    }

    /// The setting's model, the default for an unknown value.
    pub fn of(name: &str) -> SemanticModel {
        SemanticModel::from_name(name).unwrap_or(SemanticModel::DEFAULT)
    }

    /// The model directory's name under `data_models` (= catalog name).
    pub fn name(self) -> &'static str {
        match self {
            SemanticModel::ClipVitB32 => "clip_vit_b32",
            SemanticModel::MobileClipS2 => "mobileclip_s2",
        }
    }

    /// Which model a directory passed as `model` holds.
    pub fn of_dir(dir: &Path) -> SemanticModel {
        match dir.file_name().and_then(|n| n.to_str()) {
            Some("mobileclip_s2") => SemanticModel::MobileClipS2,
            _ => SemanticModel::ClipVitB32,
        }
    }

    /// Whether a stored embedding of this magnitude can come from this
    /// model: ViT-B/32 image embeddings have norms of ~9-12, MobileCLIP-S2's
    /// ~0.9-1.2 (290-photo bench corpus), so 3 separates them. Rows without
    /// a magnitude predate MobileCLIP and count as ViT-B/32.
    pub fn fits_magnitude(self, magnitude: Option<f64>) -> bool {
        match (self, magnitude) {
            (SemanticModel::ClipVitB32, None) => true,
            (SemanticModel::MobileClipS2, None) => false,
            (SemanticModel::ClipVitB32, Some(m)) => m >= MAGNITUDE_SPLIT,
            (SemanticModel::MobileClipS2, Some(m)) => m < MAGNITUDE_SPLIT,
        }
    }

    /// Inner-product cut of a text search (`search_similar_embedding`'s 27
    /// for ViT-B/32). MobileCLIP's is calibrated on the 290-photo bench
    /// corpus to keep the same share of photos per query (OPTIMIZATIONS.md #5).
    pub fn search_threshold(self) -> f64 {
        match self {
            SemanticModel::ClipVitB32 => 27.0,
            SemanticModel::MobileClipS2 => MOBILECLIP_SEARCH_THRESHOLD,
        }
    }

    /// Inner-product cut of "similar photos" in the photo detail (90 for
    /// ViT-B/32), calibrated the same way.
    pub fn similar_threshold(self) -> f64 {
        match self {
            SemanticModel::ClipVitB32 => 90.0,
            SemanticModel::MobileClipS2 => MOBILECLIP_SIMILAR_THRESHOLD,
        }
    }
}

/// See [`SemanticModel::search_threshold`]: ViT-B/32 at 27 returns 10.1
/// photos per query on average over 30 labelled queries, MobileCLIP-S2 at
/// 1.84 returns 10.2.
pub const MOBILECLIP_SEARCH_THRESHOLD: f64 = 1.84;
/// See [`SemanticModel::similar_threshold`]: ViT-B/32 at 90 gives 77.9
/// similar photos per photo on the bench corpus, MobileCLIP-S2 at 0.71 77.8.
pub const MOBILECLIP_SIMILAR_THRESHOLD: f64 = 0.71;
/// See [`SemanticModel::fits_magnitude`].
pub const MAGNITUDE_SPLIT: f64 = 3.0;

#[async_trait]
pub trait ClipApi: Send + Sync {
    async fn image_embeddings(
        &self,
        imgs: &[String],
        model: &str,
    ) -> Result<ClipEmbeddings, SidecarError>;

    async fn query_embedding(
        &self,
        query: &str,
        model: &str,
    ) -> Result<QueryEmbedding, SidecarError>;
}

#[async_trait]
impl ClipApi for Sidecars {
    async fn image_embeddings(
        &self,
        imgs: &[String],
        model: &str,
    ) -> Result<ClipEmbeddings, SidecarError> {
        self.clip_embeddings(imgs, model).await
    }

    async fn query_embedding(
        &self,
        query: &str,
        model: &str,
    ) -> Result<QueryEmbedding, SidecarError> {
        self.query_embeddings(query, model).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn semantic_models() {
        assert_eq!(SemanticModel::of(""), SemanticModel::MobileClipS2);
        assert_eq!(SemanticModel::of("clip_vit_b32"), SemanticModel::ClipVitB32);
        assert_eq!(SemanticModel::of("nope"), SemanticModel::DEFAULT);
        assert!(SemanticModel::from_name("nope").is_none());
        assert_eq!(
            SemanticModel::of_dir(Path::new("/d/data_models/mobileclip_s2")),
            SemanticModel::MobileClipS2
        );
        assert_eq!(
            SemanticModel::of_dir(Path::new("/d/data_models/clip_vit_b32")),
            SemanticModel::ClipVitB32
        );
        let (vit, mc) = (SemanticModel::ClipVitB32, SemanticModel::MobileClipS2);
        assert!(vit.fits_magnitude(Some(10.4)) && !vit.fits_magnitude(Some(0.97)));
        assert!(mc.fits_magnitude(Some(0.97)) && !mc.fits_magnitude(Some(10.4)));
        assert!(vit.fits_magnitude(None) && !mc.fits_magnitude(None));
        assert_eq!(vit.search_threshold(), 27.0);
        assert_eq!(vit.similar_threshold(), 90.0);
    }
}
