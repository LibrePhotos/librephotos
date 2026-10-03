//! Semantic search through the CLIP and similarity services, in-process or
//! sidecar (api/semantic_search.py `calculate_query_embeddings` +
//! api/image_similarity.py `search_similar_embedding`).
//!
//! Failure behaviour matches Django: a CLIP failure of any kind and an
//! unreachable similarity sidecar are errors (500); an error status from the
//! similarity sidecar means "no semantic hits".

use lp_core::{ApiError, ApiResult, AppState};
use lp_sidecars::SidecarError;

/// Image hashes of the user's photos closest to the CLIP text embedding of `query`.
pub(super) async fn semantic_search_hashes(
    state: &AppState,
    user_id: i32,
    query: &str,
    topk: i32,
) -> ApiResult<Vec<String>> {
    let model = state
        .config
        .data_models_dir()
        .join("clip_vit_b32")
        .display()
        .to_string();
    let ml = state.ml();
    let reply = ml
        .clip()
        .query_embedding(query, &model)
        .await
        .map_err(ApiError::internal)?;
    let emb: Vec<f32> = reply.emb.iter().map(|v| *v as f32).collect();
    match ml
        .similarity()
        .search(user_id, &emb, Some(topk.max(0) as usize), 27.0)
        .await
    {
        Ok(reply) => Ok(reply
            .result
            .iter()
            .filter_map(|h| h.as_str().map(str::to_string))
            .collect()),
        Err(SidecarError::Status { status, .. }) => {
            tracing::error!(
                "error retrieving similar embeddings for user {user_id}: status {status}"
            );
            Ok(Vec::new())
        }
        Err(e) => Err(ApiError::internal(e)),
    }
}
