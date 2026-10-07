//! Probes for `/api/healthz/*`.

use crate::db::Db;

pub async fn ping(pool: &Db) -> bool {
    crate::sql::query_scalar::<_, i32>("SELECT 1")
        .fetch_one(pool)
        .await
        .is_ok()
}

/// The job queue table answers (count stays private, like Django's probe).
pub async fn queue_ping(pool: &Db) -> bool {
    crate::sql::query("SELECT 1 FROM job_queue LIMIT 1")
        .fetch_optional(pool)
        .await
        .is_ok()
}
