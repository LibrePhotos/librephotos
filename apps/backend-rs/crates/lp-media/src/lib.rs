//! Media serving (03 §3): `/media/<kind>/<id>`, `/api/downloads/{name}`,
//! `/api/public/photo/{slug}/media/{kind}` and `/api/media/diagnostics/{h}`.
//! Port of `api/views/media.py` (grant order via the `lp_db::scope` grant
//! columns; anonymous refusal = 403 + `X-Media-Error: authentication`,
//! signed-in refusal = 404), delivered per `LP_MEDIA_MODE` (x-accel, or
//! direct with single ranges and HEAD), with file paths confined to
//! `MEDIA_ROOT` / the photo roots.

use axum::Router;
use axum::routing::get;
use lp_core::AppState;
use lp_jobs::HandlerRegistry;

pub mod diagnostics;
pub mod downloads;
pub mod mime;
pub mod public;
pub mod pyfmt;
pub mod serve;
pub mod transcode;
pub mod view;

/// All media routes; merged into the app by `lp-server`.
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/media/{*rest}", get(view::media))
        .route("/api/downloads/{name}", get(downloads::download))
        .route(
            "/api/public/photo/{slug}/media/{kind}",
            get(public::public_photo_media),
        )
        .route(
            "/api/media/diagnostics/{fname}",
            get(diagnostics::diagnostics),
        )
}

/// The transcode cache fills in-process after a live stream (as Django's
/// background thread does); no queued job kinds.
pub fn register_jobs(_reg: &mut HandlerRegistry) {}
