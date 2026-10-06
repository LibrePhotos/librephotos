//! Code-defined recurring jobs (04 §1). `schedule_state` records when each
//! one is next due, so restarts and several workers never double-run one.

use std::time::Duration;

use chrono::{DateTime, Utc};
use lp_db::db::Db;

use crate::queue::{EnqueueOptions, enqueue_in};

const HOUR: Duration = Duration::from_secs(3600);
const DAY: Duration = Duration::from_secs(24 * 3600);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Schedule {
    /// `schedule_state.name`.
    pub name: &'static str,
    /// Job kind enqueued when due (payload `{}`).
    pub kind: &'static str,
    pub every: Duration,
}

pub const SCHEDULES: &[Schedule] = &[
    Schedule {
        name: "cleanup_deleted_photos",
        kind: "maintenance.cleanup_deleted_photos",
        every: DAY,
    },
    Schedule {
        name: "cleanup_stuck_jobs",
        kind: "maintenance.cleanup_stuck_jobs",
        every: HOUR,
    },
    Schedule {
        name: "cleanup_old_jobs",
        kind: "maintenance.cleanup_old_jobs",
        every: DAY,
    },
    Schedule {
        name: "zip_expiry",
        kind: "maintenance.zip_expiry",
        every: HOUR,
    },
    Schedule {
        name: "prune_refresh_tokens",
        kind: "maintenance.prune_refresh_tokens",
        every: DAY,
    },
    // `start_cleaning_service`: mobile-sync tombstones past the 90-day
    // horizon (`api.services.prune_deletion_log`, daily).
    Schedule {
        name: "prune_deletion_log",
        kind: "maintenance.prune_deletion_log",
        every: DAY,
    },
];

/// Enqueue every schedule that is due, claiming it in `schedule_state` in
/// the same transaction. A schedule without a row is due at once. Returns
/// the names that were enqueued.
pub async fn run_due(db: &Db, schedules: &[Schedule]) -> sqlx::Result<Vec<&'static str>> {
    let mut fired = Vec::new();
    for s in schedules {
        // A due check that reads first: on SQLite `begin()` takes the single
        // writer, so a schedule that is not due should not ask for it.
        let next: Option<Option<DateTime<Utc>>> =
            lp_db::sql::query_scalar("SELECT next_run_at FROM schedule_state WHERE name = $1")
                .bind(s.name)
                .fetch_optional(db)
                .await?;
        if let Some(Some(at)) = next
            && at > Utc::now()
        {
            continue;
        }
        let now = Utc::now();
        let every = chrono::Duration::from_std(s.every).unwrap_or(chrono::Duration::days(1));
        let mut tx = db.begin().await?;
        let won: Option<String> = lp_db::sql::query_scalar(
            "INSERT INTO schedule_state (name, last_run_at, next_run_at) \
             VALUES ($1, $2, $3) \
             ON CONFLICT (name) DO UPDATE \
               SET last_run_at = EXCLUDED.last_run_at, next_run_at = EXCLUDED.next_run_at \
               WHERE schedule_state.next_run_at IS NULL OR schedule_state.next_run_at <= $2 \
             RETURNING name",
        )
        .bind(s.name)
        .bind(now)
        .bind(now + every)
        .fetch_optional(&mut *tx)
        .await?;
        if won.is_some() {
            enqueue_in(
                &mut tx,
                s.kind,
                serde_json::json!({}),
                &EnqueueOptions::default(),
            )
            .await?;
            fired.push(s.name);
        }
        tx.commit().await?;
    }
    Ok(fired)
}
