//! Area `users_settings`. User & settings (03 §5): GET/POST /user/, GET/PATCH /user/{id}/ (JSON or multipart avatar), PATCH /manage/user/{id}/, DELETE /delete/user/{id}/, GET/POST /sitesettings, email config x3, /timezones/ + /predefinedrules/ + /predefinedburstrules/ (JSON-encoded strings), /dirtree/, nextcloud x2; plus auth M5: /firsttimesetup/, /auth/sso/config/, /auth/password/reset/ + /confirm/.
//!
//! Register every route of this area in [`routes`] with its full path and
//! NO trailing slash (a middleware strips one). Reads go in
//! `lp_db::users_settings`, writes in `lp_db::write::users_settings`.

use axum::Router;
use lp_core::AppState;
use lp_jobs::HandlerRegistry;

pub fn routes() -> Router<AppState> {
    Router::new()
}

pub fn register_jobs(_reg: &mut HandlerRegistry) {}
