//! CLIP ViT-B/32 embeddings (`service/clip_embeddings`, sidecar :8006):
//! image embeddings for the similarity index, text embeddings for search.
//! Contract: `POST /clip-embeddings {imgs, model}` -> `{imgs_emb, magnitudes}`
//! (one slot per path, `null` where unreadable), `POST /query-embeddings
//! {query, model}` -> `{emb, magnitude}`. `model` is the model directory.

mod inprocess;

pub use inprocess::InProcess;

use async_trait::async_trait;
use lp_sidecars::{ClipEmbeddings, QueryEmbedding, SidecarError, Sidecars};

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
