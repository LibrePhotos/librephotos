//! Area `users_settings`. User & settings (03 §5): GET/POST /user/, GET/PATCH /user/{id}/ (JSON or multipart avatar), PATCH /manage/user/{id}/, DELETE /delete/user/{id}/, GET/POST /sitesettings, email config x3, /timezones/ + /predefinedrules/ + /predefinedburstrules/ (JSON-encoded strings), /dirtree/, nextcloud x2; plus auth M5: /firsttimesetup/, /auth/sso/config/, /auth/password/reset/ + /confirm/.
//!
//! OIDC login/callback: `oidc`. Not ported (left to `LP_DEV_FALLBACK`):
//! `PUT`/`DELETE /api/manage/user/{id}/`, which the frontend never calls.
//! `/api/nextcloud/scanphotos/` queues the `nextcloud.scan` job.

use axum::Router;
use axum::routing::{delete, get, post};
use lp_core::AppState;
use lp_jobs::HandlerRegistry;

mod avatar;
mod dirtree;
mod email;
mod fields;
mod input;
mod nextcloud;
mod oidc;
pub mod password_reset;
mod pypath;
mod scan_dir;
mod serialize;
mod site_settings;
mod sso;
mod static_data;
mod user;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/user", get(user::list).post(user::create))
        .route("/api/user/{id}", get(user::retrieve).patch(user::update))
        .route("/api/manage/user", get(user::manage_list))
        .route(
            "/api/manage/user/{id}",
            get(user::manage_retrieve).patch(user::manage_update),
        )
        .route("/api/delete/user/{id}", delete(user::destroy))
        .route("/api/firsttimesetup", get(user::first_time_setup))
        .route(
            "/api/sitesettings",
            get(site_settings::get).post(site_settings::post),
        )
        .route(
            "/api/email-config",
            get(email::get_config).post(email::post_config),
        )
        .route("/api/email-config/test", post(email::test_email))
        .route("/api/timezones", get(static_data::timezones))
        .route("/api/predefinedrules", get(static_data::predefined_rules))
        .route(
            "/api/predefinedburstrules",
            get(static_data::predefined_burst_rules),
        )
        .route("/api/defaultrules", get(static_data::default_rules))
        .route(
            "/api/defaultburstrules",
            get(static_data::default_burst_rules),
        )
        .route("/api/dirtree", get(dirtree::dirtree))
        .route(
            "/api/auth/password/reset",
            post(password_reset::request_reset),
        )
        .route(
            "/api/auth/password/reset/confirm",
            post(password_reset::confirm_reset),
        )
        .route("/api/auth/sso/config", get(sso::config))
        .route("/api/accounts/oidc/{id}/login", get(oidc::login))
        .route(
            "/api/accounts/oidc/{id}/login/callback",
            get(oidc::callback),
        )
        .route("/api/nextcloud/listdir", get(nextcloud::listdir))
        .route(
            "/api/nextcloud/scanphotos",
            get(nextcloud::scanphotos).post(nextcloud::scanphotos),
        )
}

pub fn register_jobs(_reg: &mut HandlerRegistry) {}
