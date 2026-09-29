//! `GET /api/auth/sso/config/` (`SSOConfigView`): what the login screen shows.
//! Unauthenticated on purpose (`authentication_classes = ()`), so a bad token
//! is not a 401 here. The OIDC login itself (`/api/accounts/oidc/...`) is not
//! ported: those paths fall through to `LP_DEV_FALLBACK` (Django) or 404.

use axum::Json;
use axum::extract::State;
use axum::response::{IntoResponse, Response};
use lp_core::{ApiResult, AppState};
use serde_json::{Value, json};

pub async fn config(State(state): State<AppState>) -> ApiResult<Response> {
    let settings = state.settings();
    let mut providers: Vec<Value> = Vec::new();
    if settings.oidc_enabled {
        for (id, name) in lp_db::users_settings::oidc_providers(&state.db).await? {
            let login_url = format!("/api/accounts/oidc/{id}/login/");
            providers.push(json!({"id": id, "name": name, "login_url": login_url}));
        }
    }
    Ok(Json(json!({
        "enabled": settings.oidc_enabled && !providers.is_empty(),
        "label": settings.oidc_button_label,
        "providers": providers,
    }))
    .into_response())
}
