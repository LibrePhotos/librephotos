//! `POST /api/savemetadata` (`SaveMetadataView`): write the requester's
//! ratings and/or face regions back to their files, synchronously.
//! `{"types": ["ratings", "face_tags"]}` (default `["ratings"]`); answers
//! `{"status": true, "written", "errors"}`.
//!
//! Like Django the target is the XMP sidecar only when the owner's
//! `save_metadata_to_disk` is `SIDECAR_FILE`; otherwise (`OFF` included)
//! the media file itself is written.

use axum::Json;
use axum::body::Bytes;
use axum::extract::State;
use axum::response::{IntoResponse, Response};
use lp_auth::AuthUser;
use lp_core::{ApiError, ApiResult, AppState};
use lp_ingest::metadata_backfill::{self, FaceFilter, RATINGS};
use serde_json::{Value, json};

fn types_of(body: &Value) -> Vec<String> {
    match body.get("types") {
        None | Some(Value::Null) => vec![RATINGS.to_string()],
        Some(Value::Array(items)) => items
            .iter()
            .map(|v| match v {
                Value::String(s) => s.clone(),
                other => other.to_string(),
            })
            .collect(),
        Some(Value::String(s)) => vec![s.clone()],
        Some(other) => vec![other.to_string()],
    }
}

pub(super) async fn save_metadata(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    body: Bytes,
) -> ApiResult<Response> {
    let body: Value = if body.iter().all(u8::is_ascii_whitespace) {
        json!({})
    } else {
        serde_json::from_slice(&body)
            .map_err(|e| ApiError::bad_request("detail", format!("JSON parse error - {e}")))?
    };
    let types = types_of(&body);
    let use_sidecar = user.save_metadata_to_disk == "SIDECAR_FILE";
    let ids =
        metadata_backfill::select_photos(&state, Some(user.id), &types, FaceFilter::LabelledFace)
            .await?;
    let outcome = metadata_backfill::write_all(
        &state,
        &ids,
        &types,
        use_sidecar,
        |hash, e| tracing::error!(error = %format!("{e:#}"), "Failed to save metadata for photo {hash}"),
        |_, _| {},
    )
    .await;
    Ok(Json(json!({
        "status": true,
        "written": outcome.written,
        "errors": outcome.errors,
    }))
    .into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn types_default_to_ratings() {
        assert_eq!(types_of(&json!({})), vec!["ratings"]);
        assert_eq!(
            types_of(&json!({"types": ["face_tags", "ratings"]})),
            vec!["face_tags", "ratings"]
        );
        assert_eq!(types_of(&json!({"types": "face_tags"})), vec!["face_tags"]);
    }
}
