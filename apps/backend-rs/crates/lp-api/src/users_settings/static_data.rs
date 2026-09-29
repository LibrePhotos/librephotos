//! `/api/timezones/`, `/api/predefinedrules/`, `/api/predefinedburstrules/`:
//! Django returns `Response(json.dumps(...))`, i.e. a JSON-encoded string the
//! frontend `JSON.parse`s. The payloads are the exact strings Django builds
//! (`date_time_extractor.ALL_TIME_ZONES_JSON`, `PREDEFINED_RULES_JSON`,
//! `burst_detection_rules.PREDEFINED_RULES_JSON`), captured from it.

use std::sync::OnceLock;

use axum::http::header::CONTENT_TYPE;
use axum::response::{IntoResponse, Response};
use lp_auth::AuthUser;

pub const TIMEZONES: &str = include_str!("data/timezones.json");
pub const PREDEFINED_RULES: &str = include_str!("data/predefinedrules.json");
pub const PREDEFINED_BURST_RULES: &str = include_str!("data/predefinedburstrules.json");

/// `api.models.email_config.PROVIDER_PRESETS`, key order kept.
pub const EMAIL_PRESETS: &str = include_str!("data/email_presets.json");

fn json_string_body(cell: &'static OnceLock<String>, payload: &'static str) -> Response {
    let body = cell.get_or_init(|| {
        serde_json::to_string(payload.trim_end_matches(['\r', '\n'])).expect("string")
    });
    ([(CONTENT_TYPE, "application/json")], body.as_str()).into_response()
}

pub async fn timezones(_user: AuthUser) -> Response {
    static BODY: OnceLock<String> = OnceLock::new();
    json_string_body(&BODY, TIMEZONES)
}

pub async fn predefined_rules(_user: AuthUser) -> Response {
    static BODY: OnceLock<String> = OnceLock::new();
    json_string_body(&BODY, PREDEFINED_RULES)
}

pub async fn predefined_burst_rules(_user: AuthUser) -> Response {
    static BODY: OnceLock<String> = OnceLock::new();
    json_string_body(&BODY, PREDEFINED_BURST_RULES)
}
