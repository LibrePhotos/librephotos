//! Area `photo_edits`. Photo edits (03 §5): PATCH /photos/edit/{h}/; /photosedit/ favorite, hide, setdeleted, DELETE-with-body delete, makepublic, share, savecaption, generateim2txt, rotate. Bulk ops take image_hashes OR {select_all, query, excluded_hashes} (lp_db::scope::photo_filters).
//!
//! Register every route of this area in [`routes`] with its full path and
//! NO trailing slash (a middleware strips one). Reads go in
//! `lp_db::photo_edits`, writes in `lp_db::write::photo_edits`.

mod bulk;
mod caption;
pub mod datetime_rules;
mod delete;
mod edit;
mod exif;
mod photo_share;
mod rotate;
mod save_metadata;

use axum::Json;
use axum::Router;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete as delete_route, patch, post};
use lp_core::extract::py_truthy;
use lp_core::{ApiError, ApiResult, AppState};
use lp_db::scope::PhotoFilterParams;
use lp_db::write::photo_edits::bulk::Selection;
use lp_jobs::HandlerRegistry;
use serde_json::{Map, Value, json};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/photos/edit/{id}", patch(edit::patch_photo))
        .route("/api/photosedit/favorite", post(bulk::favorite))
        .route("/api/photosedit/hide", post(bulk::hide))
        .route("/api/photosedit/setdeleted", post(bulk::set_deleted))
        .route("/api/photosedit/makepublic", post(bulk::make_public))
        .route("/api/photosedit/share", post(bulk::share))
        .route("/api/photosedit/savecaption", post(caption::save_caption))
        .route(
            "/api/photosedit/generateim2txt",
            post(caption::generate_im2txt),
        )
        .route("/api/photosedit/rotate", post(rotate::rotate))
        .route(
            "/api/photosedit/delete",
            delete_route(delete::delete_photos),
        )
        .route(
            "/api/photo/share/list",
            axum::routing::get(photo_share::list),
        )
        .route("/api/photo/share", post(photo_share::set_share))
        .route("/api/savemetadata", post(save_metadata::save_metadata))
}

pub fn register_jobs(_reg: &mut HandlerRegistry) {}

/// `{"status": false, "message": ...}` with a status, the shape these views
/// answer failures with (not the error envelope).
fn status_message(code: StatusCode, message: &str) -> Response {
    (code, Json(json!({"status": false, "message": message}))).into_response()
}

/// `request.data[key]` of a JSON object body; a missing key is a 400 here
/// (a `KeyError` 500 on Django).
fn required<'a>(body: &'a Map<String, Value>, key: &str) -> ApiResult<&'a Value> {
    body.get(key)
        .ok_or_else(|| ApiError::bad_request(key, "This field is required."))
}

/// Django's model `BooleanField.to_python` (what a queryset filter or
/// UPDATE does with the raw value): no lowercase "true"/"false".
fn model_bool(v: &Value) -> Option<bool> {
    match v {
        Value::Bool(b) => Some(*b),
        Value::Number(n) => match n.as_f64() {
            Some(1.0) => Some(true),
            Some(0.0) => Some(false),
            _ => None,
        },
        Value::String(s) => match s.as_str() {
            "t" | "True" | "1" => Some(true),
            "f" | "False" | "0" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

/// DRF `serializers.BooleanField.to_internal_value` (case-insensitive words).
fn drf_bool(v: &Value) -> Option<bool> {
    match v {
        Value::Bool(b) => Some(*b),
        Value::Number(n) => match n.as_f64() {
            Some(1.0) => Some(true),
            Some(0.0) => Some(false),
            _ => None,
        },
        Value::String(s) => match s.to_lowercase().as_str() {
            "t" | "y" | "yes" | "true" | "on" | "1" => Some(true),
            "f" | "n" | "no" | "false" | "off" | "0" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

/// A value Django would coerce to a string for a lookup (`str(x)`).
fn py_str(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Bool(true) => "True".into(),
        Value::Bool(false) => "False".into(),
        Value::Null => "None".into(),
        other => other.to_string(),
    }
}

fn string_list(v: Option<&Value>, field: &str) -> ApiResult<Vec<String>> {
    match v {
        None | Some(Value::Null) => Ok(Vec::new()),
        Some(Value::Array(a)) => Ok(a.iter().map(py_str).collect()),
        // Django iterates a string given where a list is expected (`__in`,
        // `dict.fromkeys`), so it names one-character hashes, not itself.
        Some(Value::String(s)) => Ok(s.chars().map(String::from).collect()),
        Some(_) => Err(ApiError::bad_request(field, "Expected a list of items.")),
    }
}

/// `image_hashes`, or `select_all` + `query` (+ `excluded_hashes`).
fn selection(body: &Map<String, Value>, force_trash: bool) -> ApiResult<Selection> {
    if body.get("select_all").is_some_and(py_truthy) {
        let query = match body.get("query") {
            None | Some(Value::Null) => json!({}),
            Some(q) => q.clone(),
        };
        let mut params = PhotoFilterParams::from_json(&query)?;
        if force_trash {
            params.in_trashcan = true;
        }
        Ok(Selection::SelectAll {
            params,
            excluded_hashes: string_list(body.get("excluded_hashes"), "excluded_hashes")?,
        })
    } else {
        let hashes = required(body, "image_hashes")?;
        Ok(Selection::Hashes(string_list(
            Some(hashes),
            "image_hashes",
        )?))
    }
}

fn metadata_to_disk(user: &lp_db::users::User) -> bool {
    user.save_metadata_to_disk != "OFF"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bools_follow_django() {
        assert_eq!(model_bool(&json!(true)), Some(true));
        assert_eq!(model_bool(&json!("False")), Some(false));
        assert_eq!(model_bool(&json!(1)), Some(true));
        assert_eq!(model_bool(&json!("false")), None);
        assert_eq!(model_bool(&json!("yes")), None);
        assert_eq!(drf_bool(&json!("YES")), Some(true));
        assert_eq!(drf_bool(&json!("false")), Some(false));
        assert_eq!(drf_bool(&json!(0.0)), Some(false));
        assert_eq!(drf_bool(&json!("maybe")), None);
    }

    #[test]
    fn selection_modes() {
        let body = json!({"image_hashes": ["a", "b"]});
        match selection(body.as_object().unwrap(), false).unwrap() {
            Selection::Hashes(h) => assert_eq!(h, vec!["a", "b"]),
            _ => panic!("hashes"),
        }
        let body =
            json!({"select_all": true, "query": {"favorite": true}, "excluded_hashes": ["x"]});
        match selection(body.as_object().unwrap(), true).unwrap() {
            Selection::SelectAll {
                params,
                excluded_hashes,
            } => {
                assert!(params.favorite && params.in_trashcan);
                assert_eq!(excluded_hashes, vec!["x"]);
            }
            _ => panic!("select_all"),
        }
        assert!(selection(json!({}).as_object().unwrap(), false).is_err());
        match selection(json!({"image_hashes": "ab"}).as_object().unwrap(), false).unwrap() {
            Selection::Hashes(h) => assert_eq!(h, vec!["a", "b"]),
            _ => panic!("string"),
        }
    }
}
