//! `/photosedit/savecaption/` and `/photosedit/generateim2txt/`. Both views
//! only have `IsOwnerOrReadOnly`, so an anonymous caller gets the owner-scope
//! 404 rather than a 401.

use std::path::Path;

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use lp_auth::OptionalUser;
use lp_core::{ApiError, ApiJson, ApiResult, AppState};
use lp_db::photo_edits as reads;
use lp_db::write::photo_edits::caption as svc;
use lp_sidecars::Sidecar;
use serde_json::{Value, json};

use super::bulk::object;
use super::{py_str, required, status_message};

const CAPTION_FAILED: &str = "Failed to generate caption. Check service logs for details.";

/// Every file of the captioner (`ML_MODELS`, type captioning), relative to
/// `data_models/`.
const CAPTIONER_FILES: [&str; 7] = [
    "lfm2_vl_450m/vision_encoder_q4.onnx",
    "lfm2_vl_450m/vision_encoder_q4.onnx_data",
    "lfm2_vl_450m/embed_tokens_q4.onnx",
    "lfm2_vl_450m/embed_tokens_q4.onnx_data",
    "lfm2_vl_450m/decoder_model_merged_q4.onnx",
    "lfm2_vl_450m/decoder_model_merged_q4.onnx_data",
    "lfm2_vl_450m/tokenizer.json",
];

pub(super) async fn save_caption(
    State(state): State<AppState>,
    OptionalUser(user): OptionalUser,
    ApiJson(body): ApiJson<Value>,
) -> ApiResult<Response> {
    let body = object(body)?;
    let image_hash = py_str(required(&body, "image_hash")?);
    let caption = required(&body, "caption")?.clone();

    let photo = match &user {
        Some(u) => reads::owned_by_hash(&state.db, u.id, &image_hash).await?,
        None => None,
    };
    let Some(photo) = photo else {
        return Ok(status_message(StatusCode::NOT_FOUND, "photo not found"));
    };
    {
        let mut conn = state.db.acquire().await?;
        svc::ensure_caption_row(&mut conn, photo.id).await?;
    }
    if !photo.has_thumbnail_row {
        return Err(ApiError::internal("photo has no thumbnail"));
    }
    if photo.thumbnail_big.as_deref().unwrap_or("").is_empty() {
        return Ok(Json(json!({"status": false})).into_response());
    }
    let Value::String(caption) = caption else {
        return Ok(Json(json!({"status": false})).into_response());
    };

    let tagging_model = state.settings().tagging_model.clone();
    let mut tx = state.db.begin().await?;
    let ok = match svc::save_user_caption(&mut tx, photo.id, &caption, &tagging_model).await {
        Ok(_) => {
            tx.commit().await?;
            true
        }
        Err(e) => {
            tracing::warn!(error = %e, image_hash, "could not save captions");
            false
        }
    };
    Ok(Json(json!({"status": ok})).into_response())
}

fn captioning_model_exists(models_dir: &Path) -> bool {
    CAPTIONER_FILES.iter().all(|f| models_dir.join(f).exists())
}

/// `_caption_prompt(_caption_context(llm_settings))`.
fn caption_prompt(llm: &Value, person: Option<&str>, location: Option<&str>) -> String {
    let flag = |k: &str| llm.get(k).is_some_and(lp_core::extract::py_truthy);
    if !flag("enabled") {
        return "Describe this image in a short, natural image caption.".into();
    }
    let person = if flag("add_person") { person } else { None };
    let location = if flag("add_location") {
        location.filter(|l| !l.is_empty())
    } else {
        None
    };
    let mut prompt = String::from("Write a short, natural image caption.");
    if let Some(name) = person {
        prompt.push_str(&format!(
            " The person in the photo is named {name}. Use the name '{name}' directly in the caption \u{2014} do not say 'a person named'. Keep the caption casual and to the point, like a friend tagging a photo."
        ));
    }
    if let Some(place) = location {
        prompt.push_str(&format!(" This photo was taken at {place}."));
    }
    if flag("add_keywords") {
        prompt.push_str(" Include relevant tags and keywords.");
    }
    prompt
}

/// `api.image_captioning.generate_caption`: one synchronous sidecar call.
async fn call_caption_sidecar(
    state: &AppState,
    image_path: &str,
    prompt: &str,
) -> anyhow::Result<String> {
    let res = state
        .sidecars
        .http()
        .post(state.sidecars.url(Sidecar::Caption, "/generate-caption"))
        .json(&json!({"image_path": image_path, "prompt": prompt}))
        .timeout(Sidecar::Caption.timeout())
        .send()
        .await?;
    let status = res.status();
    let body: Value = res.json().await.unwrap_or(Value::Null);
    match body.get("caption") {
        Some(c) if status.is_success() => Ok(py_str(c)),
        _ => anyhow::bail!(
            "captioning sidecar returned HTTP {status}: {}",
            body.get("error")
                .map(py_str)
                .unwrap_or_else(|| "no caption in reply".into())
        ),
    }
}

pub(super) async fn generate_im2txt(
    State(state): State<AppState>,
    OptionalUser(user): OptionalUser,
    ApiJson(body): ApiJson<Value>,
) -> ApiResult<Response> {
    if !state.config.features.image_captioning {
        return Ok(status_message(
            StatusCode::FORBIDDEN,
            "Image captioning is disabled",
        ));
    }
    let body = object(body)?;
    let image_hash = py_str(required(&body, "image_hash")?);
    let photo = match &user {
        Some(u) => reads::owned_by_hash(&state.db, u.id, &image_hash).await?,
        None => None,
    };
    let (Some(photo), Some(user)) = (photo, user) else {
        return Ok(status_message(StatusCode::NOT_FOUND, "photo not found"));
    };

    if !captioning_model_exists(&state.config.data_models_dir()) {
        // The model download is not a job kind of the Rust queue yet; the
        // answer is the one the frontend turns into its "downloading" notice.
        return Ok(Json(json!({
            "status": false,
            "reason": "model_downloading",
            "message": "The captioning model is being downloaded. Try again in a few minutes.",
        }))
        .into_response());
    }
    {
        let mut conn = state.db.acquire().await?;
        svc::ensure_caption_row(&mut conn, photo.id).await?;
    }
    if !photo.has_thumbnail_row {
        return Err(ApiError::internal("photo has no thumbnail"));
    }
    let thumb = photo.thumbnail_big.clone().unwrap_or_default();
    if thumb.is_empty()
        || state
            .settings()
            .captioning_model
            .eq_ignore_ascii_case("none")
    {
        return Ok(status_message(
            StatusCode::INTERNAL_SERVER_ERROR,
            CAPTION_FAILED,
        ));
    }
    let image_path = state.config.media_root.join(&thumb).display().to_string();
    let ctx = reads::caption_context(&state.db, photo.id).await?;
    let llm = match &user.llm_settings {
        Value::String(s) => serde_json::from_str(s).unwrap_or(Value::Null),
        other => other.clone(),
    };
    let prompt = caption_prompt(
        &llm,
        ctx.person_name.as_deref(),
        ctx.search_location.as_deref(),
    );
    let caption = match call_caption_sidecar(&state, &image_path, &prompt).await {
        Ok(c) => svc::clean_caption(&c),
        Err(e) => {
            tracing::warn!(error = %e, image_path, "could not generate caption");
            return Ok(status_message(
                StatusCode::INTERNAL_SERVER_ERROR,
                CAPTION_FAILED,
            ));
        }
    };
    let tagging_model = state.settings().tagging_model.clone();
    let mut tx = state.db.begin().await?;
    if let Err(e) = svc::store_generated_caption(&mut tx, photo.id, &caption, &tagging_model).await
    {
        tracing::warn!(error = %e, image_path, "could not store caption");
        return Ok(status_message(
            StatusCode::INTERNAL_SERVER_ERROR,
            CAPTION_FAILED,
        ));
    }
    tx.commit().await?;
    Ok(Json(json!({"status": true})).into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompts() {
        let off = json!({"enabled": false});
        assert_eq!(
            caption_prompt(&off, Some("Anna"), None),
            "Describe this image in a short, natural image caption."
        );
        let on = json!({"enabled": true, "add_person": true, "add_location": true, "add_keywords": false});
        let p = caption_prompt(&on, Some("Anna"), Some("Berlin"));
        assert!(p.starts_with(
            "Write a short, natural image caption. The person in the photo is named Anna."
        ));
        assert!(p.ends_with(" This photo was taken at Berlin."));
    }
}
