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
/// is never loaded.
///
/// Every stored embedding names the model that produced it
/// (`api_photo.clip_embeddings_model`, NULL = Django's ViT-B/32, see
/// [`SemanticModel::stored`]). The similarity index holds only the selected
/// model's embeddings; `lp_tasks::clip::reembed_mismatched` (at startup and
/// after a settings change) queues `clip.embed`, which replaces the others
/// in place, so after a switch search keeps working on the photos already
/// converted and nothing is dropped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SemanticModel {
    ClipVitB32,
    MobileClipS2,
}

impl SemanticModel {
    pub const DEFAULT: SemanticModel = SemanticModel::MobileClipS2;
    /// The model of embeddings whose `clip_embeddings_model` is NULL:
    /// Django's only semantic-search model. SQL spells it
    /// `coalesce(clip_embeddings_model, 'clip_vit_b32')`.
    pub const LEGACY: SemanticModel = SemanticModel::ClipVitB32;

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

    /// The model of a stored embedding, from its `clip_embeddings_model`
    /// column: NULL means Django (or Rust before the column existed) wrote
    /// it, and Django only has ViT-B/32 ([`SemanticModel::LEGACY`]); an
    /// unknown name is `None` (no model's index takes it).
    ///
    /// The magnitude is deliberately not consulted: ViT-B/32 image norms
    /// are ~9-12 and MobileCLIP-S2's ~0.9-1.2 on the bench corpus, but rows
    /// written by tests, fixtures or other tools need not follow that.
    pub fn stored(column: Option<&str>) -> Option<SemanticModel> {
        match column {
            None => Some(SemanticModel::LEGACY),
            Some("clip_vit_b32") => Some(SemanticModel::ClipVitB32),
            Some("mobileclip_s2") => Some(SemanticModel::MobileClipS2),
            Some(_) => None,
        }
    }

    /// Whether an embedding stored with this `clip_embeddings_model` comes
    /// from this model (and so belongs in its similarity index).
    pub fn produced(self, column: Option<&str>) -> bool {
        SemanticModel::stored(column) == Some(self)
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
        assert_eq!(vit.search_threshold(), 27.0);
        assert_eq!(vit.similar_threshold(), 90.0);
        assert_eq!(mc.name(), "mobileclip_s2");
    }

    #[test]
    fn stored_model_column() {
        let (vit, mc) = (SemanticModel::ClipVitB32, SemanticModel::MobileClipS2);
        // NULL = written by Django (or by Rust before the column) = ViT-B/32;
        // the SQL `coalesce(clip_embeddings_model, 'clip_vit_b32')` agrees.
        assert_eq!(SemanticModel::LEGACY, vit);
        assert_eq!(SemanticModel::LEGACY.name(), "clip_vit_b32");
        assert_eq!(SemanticModel::stored(None), Some(vit));
        assert!(vit.produced(None) && !mc.produced(None));
        assert!(vit.produced(Some("clip_vit_b32")) && !mc.produced(Some("clip_vit_b32")));
        assert!(mc.produced(Some("mobileclip_s2")) && !vit.produced(Some("mobileclip_s2")));
        // Every model round-trips through its column value.
        for m in [vit, mc] {
            assert_eq!(SemanticModel::stored(Some(m.name())), Some(m));
        }
        // Unknown names (and "", which the setting maps to the default)
        // belong to no index.
        for odd in ["", "nope", "MOBILECLIP_S2"] {
            assert_eq!(SemanticModel::stored(Some(odd)), None, "{odd:?}");
            assert!(!vit.produced(Some(odd)) && !mc.produced(Some(odd)));
        }
    }
}
