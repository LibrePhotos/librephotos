//! Semantic search through the CLIP (:8006) and similarity (:8002) sidecars
//! (api/semantic_search.py `calculate_query_embeddings` +
//! api/image_similarity.py `search_similar_embedding`). Kept in one place so
//! the integrator can swap in typed `lp_sidecars` clients.
//!
//! Failure behaviour matches Django: a CLIP failure of any kind and an
//! unreachable similarity sidecar are errors (500); an error status from the
//! similarity sidecar means "no semantic hits".

use std::time::Duration;

use lp_core::{ApiError, ApiResult, AppState};
use lp_sidecars::Sidecar;
use serde_json::{Value, json};

const RETRIES: u32 = 2;

/// POST with the sidecar retry policy of api/sidecars.py: connection
/// failures and 503s are retried twice, a timed-out read never.
async fn post(
    state: &AppState,
    url: &str,
    body: &Value,
    timeout: Duration,
) -> reqwest::Result<reqwest::Response> {
    let mut attempt = 0;
    loop {
        let res = state
            .http
            .post(url)
            .timeout(timeout)
            .json(body)
            .send()
            .await;
        let retry = match &res {
            Ok(r) => r.status() == reqwest::StatusCode::SERVICE_UNAVAILABLE,
            Err(e) => e.is_connect(),
        };
        if !retry || attempt >= RETRIES {
            return res;
        }
        tokio::time::sleep(Duration::from_millis(500 << attempt)).await;
        attempt += 1;
    }
}

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
    let res = post(
        state,
        &state.sidecars.url(Sidecar::Clip, "/query-embeddings"),
        &json!({"query": query, "model": model}),
        Sidecar::Clip.timeout(),
    )
    .await
    .map_err(ApiError::internal)?
    .error_for_status()
    .map_err(ApiError::internal)?;
    let body: Value = res.json().await.map_err(ApiError::internal)?;
    let emb: Vec<f32> = body
        .get("emb")
        .and_then(Value::as_array)
        .ok_or_else(|| ApiError::internal("query embedding missing from the CLIP reply"))?
        .iter()
        .map(|v| v.as_f64().unwrap_or(0.0) as f32)
        .collect();

    let res = post(
        state,
        &state.sidecars.url(Sidecar::Similarity, "/search/"),
        &json!({"user_id": user_id, "image_embedding": emb, "n": topk, "threshold": 27}),
        Sidecar::Similarity.timeout(),
    )
    .await
    .map_err(ApiError::internal)?;
    if !res.status().is_success() {
        tracing::error!(
            "error retrieving similar embeddings for user {user_id}: status {}",
            res.status()
        );
        return Ok(Vec::new());
    }
    let body: Value = res.json().await.map_err(ApiError::internal)?;
    Ok(body
        .get("result")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|h| h.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default())
}
