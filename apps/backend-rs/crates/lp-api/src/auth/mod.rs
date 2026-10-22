//! Area `auth`: token obtain/refresh/blacklist, implemented in `lp-auth`.

use axum::Router;
use lp_core::AppState;

pub fn routes() -> Router<AppState> {
    lp_auth::routes()
}
