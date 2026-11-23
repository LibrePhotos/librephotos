//! `GET/POST /api/sitesettings` (`api/views/site_settings.py`), validated like
//! `api/schemas/site_settings.py`.

use axum::Json;
use axum::extract::State;
use axum::response::{IntoResponse, Response};
use lp_auth::{AdminUser, OptionalUser};
use lp_core::{ApiError, ApiJson, ApiResult, AppState, SiteSettings};
use serde_json::{Value, json};

/// (request key, constance key, JSON type) in the schema's order.
const FIELDS: &[(&str, &str, &str)] = &[
    ("allow_registration", "ALLOW_REGISTRATION", "boolean"),
    ("allow_upload", "ALLOW_UPLOAD", "boolean"),
    ("skip_patterns", "SKIP_PATTERNS", "string"),
    ("map_api_provider", "MAP_API_PROVIDER", "string"),
    ("map_api_key", "MAP_API_KEY", "string"),
    ("map_tile_provider", "MAP_TILE_PROVIDER", "string"),
    ("captioning_model", "CAPTIONING_MODEL", "string"),
    ("tagging_model", "TAGGING_MODEL", "string"),
    ("ocr_model", "OCR_MODEL", "string"),
    ("face_recognition_model", "FACE_RECOGNITION_MODEL", "string"),
    ("semantic_search_model", "SEMANTIC_SEARCH_MODEL", "string"),
    ("nextcloud_enabled", "NEXTCLOUD_ENABLED", "boolean"),
    (
        "auto_create_user_directory",
        "AUTO_CREATE_USER_DIRECTORY",
        "boolean",
    ),
];

fn body(s: &SiteSettings, is_staff: bool, email_configured: bool) -> Value {
    json!({
        "allow_registration": s.allow_registration,
        "allow_upload": s.allow_upload,
        "skip_patterns": s.skip_patterns,
        "heavyweight_process": 0,
        "map_api_provider": s.map_api_provider,
        "map_api_key": if is_staff { s.map_api_key.as_str() } else { "" },
        "map_tile_provider": s.map_tile_provider,
        "captioning_model": s.captioning_model,
        "llm_model": "None",
        "tagging_model": s.tagging_model,
        "ocr_model": s.ocr_model,
        "face_recognition_model": s.face_recognition_model,
        "semantic_search_model": s.semantic_search_model,
        "nextcloud_enabled": s.nextcloud_enabled,
        "auto_create_user_directory": s.auto_create_user_directory,
        "email_configured": email_configured,
    })
}

pub async fn get(
    State(state): State<AppState>,
    OptionalUser(viewer): OptionalUser,
) -> ApiResult<Response> {
    let is_staff = viewer.as_ref().is_some_and(|u| u.is_staff);
    let configured = super::email::email_is_configured(&state).await;
    Ok(Json(body(&state.settings(), is_staff, configured)).into_response())
}

/// `jsonschema.validate(request.data, site_settings_schema)`. Django lets the
/// `ValidationError` escape as a 500; this answers 400 with the same message.
fn validate(data: &Value) -> Result<Vec<(&'static str, Value)>, ApiError> {
    let Some(obj) = data.as_object() else {
        return Err(ApiError::validation(format!(
            "{data} is not of type 'object'"
        )));
    };
    let mut changes = Vec::new();
    for (key, constance, ty) in FIELDS {
        let Some(v) = obj.get(*key) else { continue };
        let ok = match *ty {
            "boolean" => v.is_boolean(),
            _ => v.is_string(),
        };
        if !ok {
            return Err(ApiError::bad_request(
                *key,
                format!("{v} is not of type '{ty}'"),
            ));
        }
        changes.push((*constance, v.clone()));
    }
    if changes.is_empty() {
        return Err(ApiError::validation(format!(
            "{data} is not valid under any of the given schemas"
        )));
    }
    Ok(changes)
}

pub async fn post(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    ApiJson(data): ApiJson<Value>,
) -> ApiResult<Response> {
    let changes = validate(&data)?;
    if let Some((_, v)) = changes.iter().find(|(k, _)| *k == "SEMANTIC_SEARCH_MODEL")
        && lp_ml::clip::SemanticModel::from_name(v.as_str().unwrap_or("")).is_none()
    {
        return Err(ApiError::bad_request(
            "semantic_search_model",
            format!("{v} is not one of ['clip_vit_b32', 'mobileclip_s2']"),
        ));
    }
    let refs: Vec<(&str, Value)> = changes.into_iter().collect();
    let fresh = lp_db::write::settings::save(&state, &refs).await?;
    lp_tasks::models::queue_if_missing(&state, admin.id).await;
    // Embeddings of two models must never share an index.
    lp_tasks::clip::reembed_mismatched(&state).await?;
    let configured = super::email::email_is_configured(&state).await;
    Ok(Json(body(&fresh, admin.is_staff, configured)).into_response())
}
