//! Probes for `/api/healthz/*`.

use sqlx::PgPool;

pub async fn ping(pool: &PgPool) -> bool {
    sqlx::query_scalar::<_, i32>("SELECT 1")
        .fetch_one(pool)
        .await
        .is_ok()
}

/// The job queue table answers (count stays private, like Django's probe).
pub async fn queue_ping(pool: &PgPool) -> bool {
    sqlx::query("SELECT 1 FROM job_queue LIMIT 1")
        .fetch_optional(pool)
        .await
        .is_ok()
}
