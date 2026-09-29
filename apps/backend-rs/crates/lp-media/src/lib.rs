//! Media serving (03 §3): `/media/<kind>/<id>`, `/api/downloads/{name}` and
//! `/api/public/photo/{slug}/media/...`. Port of `api/views/media.py`
//! (grant order via `lp_db::scope::album_share_grants`; anonymous refusal =
//! 403 + `X-Media-Error: authentication`, signed-in refusal = 404), delivered
//! per `LP_MEDIA_MODE` (x-accel or direct with ranges), paths canonicalized
//! and confined to `MEDIA_ROOT` / the photo roots.
//!
//! TODO(media agent): everything; register routes in [`routes`] only.

use axum::Router;
use lp_core::AppState;
use lp_jobs::HandlerRegistry;

/// All media routes; merged into the app by `lp-server`.
pub fn routes() -> Router<AppState> {
    Router::new()
}

/// Media-owned job kinds (e.g. transcode cache fill).
pub fn register_jobs(_reg: &mut HandlerRegistry) {}
