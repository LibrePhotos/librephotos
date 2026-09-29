//! Area `stats_admin_stacks_dupes`. Stats, server/admin, stacks, duplicates (03 §5): /stats/, /photomonthcounts/, /wordcloud/, /socialgraph/, /locationsunburst/, /locationtimeline/, /storagestats/, /imagetag/, /serverstats/, /serverlogs, /serverlogs/view?lines=; stacks x9 (custom paging); duplicates x8 (no trailing slashes).
//!
//! Register every route of this area in [`routes`] with its full path and
//! NO trailing slash (a middleware strips one). Reads go in
//! `lp_db::stats_admin_stacks_dupes`, writes in `lp_db::write::stats_admin_stacks_dupes`.

use axum::Router;
use lp_core::AppState;
use lp_jobs::HandlerRegistry;

pub fn routes() -> Router<AppState> {
    Router::new()
}

pub fn register_jobs(_reg: &mut HandlerRegistry) {}
