//! Per-user nearest-neighbour index over CLIP embeddings
//! (`image_similarity/`, sidecar :8002; FAISS inner product in Python).
//! Contract: `POST /build/ {user_id, image_hashes, image_embeddings, begin?,
//! commit?}` -> `{status, index_size}` (paged rebuild: `begin` on the first
//! page, `commit` on the last; staged until commit), `DELETE /build/
//! {user_id}`, `POST /search/ {user_id, image_embedding, n?=100,
//! threshold?}` -> `{status, result: [image_hash]}`. Indices persist under
//! `MEDIA_ROOT/similarity`.

mod inprocess;

pub use inprocess::InProcess;

use async_trait::async_trait;
use lp_sidecars::{
    SidecarError, Sidecars, SimilarityBuild, SimilarityBuildReply, SimilaritySearchReply,
};
use serde_json::Value;

#[async_trait]
pub trait SimilarityApi: Send + Sync {
    async fn build(&self, page: &SimilarityBuild<'_>)
    -> Result<SimilarityBuildReply, SidecarError>;

    async fn search(
        &self,
        user_id: i32,
        embedding: &[f32],
        n: Option<usize>,
        threshold: f64,
    ) -> Result<SimilaritySearchReply, SidecarError>;

    async fn delete(&self, user_id: i32) -> Result<Value, SidecarError>;
}

#[async_trait]
impl SimilarityApi for Sidecars {
    async fn build(
        &self,
        page: &SimilarityBuild<'_>,
    ) -> Result<SimilarityBuildReply, SidecarError> {
        self.similarity_build(page).await
    }

    async fn search(
        &self,
        user_id: i32,
        embedding: &[f32],
        n: Option<usize>,
        threshold: f64,
    ) -> Result<SimilaritySearchReply, SidecarError> {
        self.similarity_search(user_id, embedding, n, threshold)
            .await
    }

    async fn delete(&self, user_id: i32) -> Result<Value, SidecarError> {
        self.similarity_delete(user_id).await
    }
}
