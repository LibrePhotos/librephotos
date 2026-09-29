//! The one synchronous similarity-sidecar call of the photo detail
//! (`search_similar_image`). Kept alone so it can be swapped for a typed
//! `lp_sidecars` client.

use lp_core::AppState;
use lp_sidecars::Sidecar;
use serde_json::{Value, json};

/// Image hashes the owner's similarity index returns for `embedding`
/// (threshold 90, as the detail serializer asks). Any failure, including a
/// sidecar that is not running, is an empty list.
pub async fn similar_hashes(state: &AppState, owner_id: i32, embedding: &[f32]) -> Vec<String> {
    let url = state.sidecars.url(Sidecar::Similarity, "/search/");
    let body = json!({
        "user_id": owner_id,
        "image_embedding": embedding,
        "threshold": 90,
    });
    let res = match state
        .sidecars
        .http()
        .post(url)
        .timeout(Sidecar::Similarity.timeout())
        .json(&body)
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => r,
        Ok(r) => {
            tracing::warn!(status = %r.status(), "similarity sidecar refused a search");
            return Vec::new();
        }
        Err(e) => {
            tracing::debug!(error = %e, "similarity sidecar unavailable");
            return Vec::new();
        }
    };
    match res.json::<Value>().await {
        Ok(v) => v
            .get("result")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|h| h.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}
