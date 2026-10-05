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

fn done_marks() -> &'static Mutex<Vec<Instant>> {
    static D: OnceLock<Mutex<Vec<Instant>>> = OnceLock::new();
    D.get_or_init(Default::default)
}

/// A file group finished (for the completion curve in [`report`]).
pub fn mark_done() {
    if enabled() {
        done_marks()
            .lock()
            .expect("scan timers")
            .push(Instant::now());
    }
}

/// Log the totals (seconds, count, ms per call) and reset them.
pub fn report(wall: Duration) {
    if !enabled() {
        return;
    }
    let mut marks = std::mem::take(&mut *done_marks().lock().expect("scan timers"));
    marks.sort();
    if let Some(start) = Instant::now().checked_sub(wall) {
        let at = |q: f64| {
            let i = ((marks.len() as f64 * q).ceil() as usize).clamp(1, marks.len().max(1)) - 1;
            marks
                .get(i)
                .map(|t| format!("{:.1}", t.duration_since(start).as_secs_f64()))
        };
        tracing::info!(
            groups = marks.len(),
            p25 = ?at(0.25),
            p50 = ?at(0.5),
            p90 = ?at(0.9),
            p99 = ?at(0.99),
            p100 = ?at(1.0),
            "scan timer: seconds until this share of file groups was done"
        );
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

/// Adds its stage's time to the scan timers when dropped.
pub struct Timed(pub &'static str, pub Instant);

impl Drop for Timed {
    fn drop(&mut self) {
        add(self.0, self.1);
    }
}
