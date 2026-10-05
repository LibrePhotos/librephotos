//! Per-stage wall-clock timers of the scan (`LP_SCAN_TIMERS=1`, off by
//! default; round 3 #21): every step of a photo adds its duration under a
//! name, and the scan logs the totals when it ends. Summed over concurrent
//! photos, so a stage's total divided by the scan's wall time is how many
//! photos sat in it on average.

use std::collections::BTreeMap;
use std::sync::Mutex;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

/// `LP_SCAN_TIMERS` is set to `1`.
pub fn enabled() -> bool {
    static ON: OnceLock<bool> = OnceLock::new();
    *ON.get_or_init(|| {
        std::env::var("LP_SCAN_TIMERS")
            .map(|v| matches!(v.trim(), "1" | "on" | "true"))
            .unwrap_or(false)
    })
}

fn table() -> &'static Mutex<BTreeMap<&'static str, (Duration, u64)>> {
    static T: OnceLock<Mutex<BTreeMap<&'static str, (Duration, u64)>>> = OnceLock::new();
    T.get_or_init(Default::default)
}

/// Add the time since `since` to `stage`.
pub fn add(stage: &'static str, since: Instant) {
    if !enabled() {
        return;
    }
    let d = since.elapsed();
    let mut t = table().lock().expect("scan timers");
    let e = t.entry(stage).or_default();
    e.0 += d;
    e.1 += 1;
}

/// Time `fut` under `stage`.
pub async fn time<F: std::future::Future>(stage: &'static str, fut: F) -> F::Output {
    let t = Instant::now();
    let out = fut.await;
    add(stage, t);
    out
}

/// Log the totals (seconds, count, ms per call) and reset them.
pub fn report(wall: Duration) {
    if !enabled() {
        return;
    }
    let t = std::mem::take(&mut *table().lock().expect("scan timers"));
    let wall_s = wall.as_secs_f64().max(1e-9);
    for (stage, (d, n)) in t {
        tracing::info!(
            stage,
            total_s = format!("{:.1}", d.as_secs_f64()),
            calls = n,
            ms_per_call = format!("{:.1}", d.as_secs_f64() * 1000.0 / n.max(1) as f64),
            avg_in_stage = format!("{:.2}", d.as_secs_f64() / wall_s),
            "scan timer"
        );
    }
}
