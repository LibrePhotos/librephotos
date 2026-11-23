//! Background jobs of this area: `stacks.detect` (burst detection,
//! `api/stack_detection.py`) and `dupes.detect` (`api/duplicate_detection.py`).
//! Payloads: `{user_id, options}` with the options the detect endpoints echo.

pub mod burst;
pub mod dupes;
pub mod exif;
pub mod phash;
pub mod stacks;

use lp_core::AppState;
use lp_jobs::{HandlerRegistry, JobCtx};
use serde_json::{Value, json};

pub const STACKS_DETECT: &str = "stacks.detect";
pub const DUPES_DETECT: &str = "dupes.detect";

pub fn register(reg: &mut HandlerRegistry) {
    reg.register(STACKS_DETECT, |ctx: JobCtx| async move {
        run(ctx, |state, user_id, options, lrj| async move {
            let n = stacks::detect(&state, user_id, &options, lrj.as_deref()).await?;
            Ok(json!({"status": "completed", "stacks_found": n}))
        })
        .await
    });
    reg.register(DUPES_DETECT, |ctx: JobCtx| async move {
        run(ctx, |state, user_id, options, lrj| async move {
            let n = dupes::detect(&state, user_id, &options, lrj.as_deref()).await?;
            Ok(json!({"status": "completed", "duplicates_found": n}))
        })
        .await
    });
}

/// Start the LongRunningJob, run `body`, then complete or fail it.
async fn run<F, Fut>(ctx: JobCtx, body: F) -> anyhow::Result<()>
where
    F: FnOnce(AppState, i32, Value, Option<String>) -> Fut,
    Fut: std::future::Future<Output = anyhow::Result<Value>>,
{
    let payload = &ctx.job.payload;
    let user_id = payload
        .get("user_id")
        .and_then(Value::as_i64)
        .ok_or_else(|| anyhow::anyhow!("payload without user_id"))? as i32;
    let options = payload.get("options").cloned().unwrap_or_else(|| json!({}));
    let lrj = ctx.job.lrj_id.clone();
    if let Some(id) = &lrj {
        lp_jobs::lrj::start(&ctx.state.db, id, None).await?;
    }
    match body(ctx.state.clone(), user_id, options, lrj.clone()).await {
        Ok(result) => {
            if let Some(id) = &lrj {
                lp_jobs::lrj::finish(&ctx.state.db, id, Some(&result)).await?;
            }
            Ok(())
        }
        Err(e) => {
            if let Some(id) = &lrj {
                lp_jobs::lrj::fail(&ctx.state.db, id, &format!("{e:#}")).await?;
            }
            Err(e)
        }
    }
}

/// `job.set_result({"stage", "current", "total", "found"})`; best effort.
pub async fn progress(
    state: &AppState,
    lrj: Option<&str>,
    stage: &str,
    current: usize,
    total: usize,
    found: usize,
) {
    if let Some(id) = lrj {
        let r = json!({"stage": stage, "current": current, "total": total, "found": found});
        if let Err(e) = lp_jobs::lrj::set_result(&state.db, id, &r).await {
            tracing::warn!(error = %e, "job progress");
        }
    }
}

/// Python truthiness of `options.get(key, default)`.
pub fn option_flag(options: &Value, key: &str, default: bool) -> bool {
    options
        .get(key)
        .map(lp_core::extract::py_truthy)
        .unwrap_or(default)
}
