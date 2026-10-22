//! `GET /api/photo/share/list` and `POST /api/photo/share` (public photo
//! links, `public_photos.PhotoShareList` / `SetPhotoShare`).

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use lp_auth::AuthUser;
use lp_core::time::drf_datetime;
use lp_core::{ApiJson, ApiResult, AppState};
use lp_db::photo_edits::{self as reads, ShareRow};
use lp_db::write::photo_edits::sharing as svc;
use serde_json::{Map, Value, json};

use super::bulk::object;
use super::status_message;

const ACTIONS: [&str; 3] = ["enable", "rotate", "disable"];

/// `_share_payload`.
fn payload(share: Option<&ShareRow>) -> Map<String, Value> {
    let mut m = Map::new();
    match share {
        Some(s) if s.enabled && s.slug.as_deref().is_some_and(|x| !x.is_empty()) => {
            let slug = s.slug.clone().unwrap_or_default();
            m.insert("enabled".into(), json!(true));
            m.insert("slug".into(), json!(slug));
            m.insert("url".into(), json!(format!("/public/p/{slug}")));
            m.insert("created_at".into(), json!(drf_datetime(&s.created_at)));
        }
        _ => {
            m.insert("enabled".into(), json!(false));
            m.insert("slug".into(), Value::Null);
            m.insert("url".into(), Value::Null);
        }
    }
    m
}

pub(super) async fn list(State(state): State<AppState>, user: AuthUser) -> ApiResult<Json<Value>> {
    let shares = reads::active_shares(&state.db, user.id).await?;
    let results: Vec<Value> = shares
        .iter()
        .map(|s| {
            let mut m = payload(Some(s));
            m.insert("photo_id".into(), json!(s.photo_id.to_string()));
            m.insert("image_hash".into(), json!(s.image_hash));
            Value::Object(m)
        })
        .collect();
    Ok(Json(json!({ "results": results })))
}

pub(super) async fn set_share(
    State(state): State<AppState>,
    user: AuthUser,
    ApiJson(body): ApiJson<Value>,
) -> ApiResult<Response> {
    let body = object(body)?;
    let photo_id = match body.get("photo_id") {
        Some(Value::String(s)) if !s.is_empty() => s.clone(),
        _ => {
            return Ok(status_message(
                StatusCode::BAD_REQUEST,
                "Missing parameters",
            ));
        }
    };
    let action = match body.get("action") {
        None => "enable".to_string(),
        Some(v) if !lp_core::extract::py_truthy(v) => "enable".to_string(),
        Some(Value::String(s)) if ACTIONS.contains(&s.to_lowercase().as_str()) => s.to_lowercase(),
        Some(_) => return Ok(status_message(StatusCode::BAD_REQUEST, "Unknown action")),
    };
    let Some(photo) = reads::owned_by_id_or_hash(&state.db, user.id, &photo_id).await? else {
        return Ok(status_message(StatusCode::NOT_FOUND, "No such photo"));
    };

    let mut tx = state.db.begin().await?;
    let share = match action.as_str() {
        "disable" => svc::disable_share(&mut tx, photo.id).await?,
        other => Some(svc::enable_share(&mut tx, photo.id, other == "rotate").await?),
    };
    tx.commit().await?;
    Ok(Json(json!({"status": true, "share": payload(share.as_ref())})).into_response())
}
