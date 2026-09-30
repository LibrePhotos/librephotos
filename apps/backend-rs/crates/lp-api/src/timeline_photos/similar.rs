//! The one synchronous similarity call of the photo detail
//! (`search_similar_image`), in-process or through the sidecar.

use lp_core::AppState;
use lp_sidecars::SidecarError;

/// Image hashes the owner's similarity index returns for `embedding`
/// (threshold 90, as the detail serializer asks). Any failure, including a
/// sidecar that is not running, is an empty list.
pub async fn similar_hashes(state: &AppState, owner_id: i32, embedding: &[f32]) -> Vec<String> {
    match state
        .ml()
        .similarity()
        .search(owner_id, embedding, None, 90.0)
        .await
    {
        Ok(reply) => reply
            .result
            .iter()
            .filter_map(|h| h.as_str().map(str::to_string))
            .collect(),
        Err(e @ SidecarError::Status { .. }) => {
            tracing::warn!(error = %e, "similarity service refused a search");
            Vec::new()
        }
        Err(e) => {
            tracing::debug!(error = %e, "similarity service unavailable");
            Vec::new()
        }
    }
}
