use std::collections::BTreeMap;
use std::time::Duration;

use hdrhistogram::Histogram;
use serde::Serialize;

/// Latencies in microseconds, 1 µs .. 120 s.
pub fn hist() -> Histogram<u64> {
    Histogram::new_with_bounds(1, 120_000_000, 3).expect("histogram bounds")
}

pub fn record(h: &mut Histogram<u64>, d: Duration) {
    let us = (d.as_micros() as u64).clamp(1, 120_000_000);
    h.record(us).ok();
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct Latency {
    pub n: u64,
    pub mean_ms: f64,
    pub p50_ms: f64,
    pub p90_ms: f64,
    pub p99_ms: f64,
    pub max_ms: f64,
}

pub fn summarize(h: &Histogram<u64>) -> Latency {
    if h.is_empty() {
        return Latency::default();
    }
    let ms = |v: u64| v as f64 / 1000.0;
    Latency {
        n: h.len(),
        mean_ms: h.mean() / 1000.0,
        p50_ms: ms(h.value_at_quantile(0.5)),
        p90_ms: ms(h.value_at_quantile(0.9)),
        p99_ms: ms(h.value_at_quantile(0.99)),
        max_ms: ms(h.max()),
    }
}

/// Counters shared by the load modes.
#[derive(Debug, Default, Clone, Serialize)]
pub struct Counts {
    pub ok: u64,
    pub check_failed: u64,
    pub errors: u64,
    pub bytes: u64,
    pub statuses: BTreeMap<u16, u64>,
    pub error_kinds: BTreeMap<String, u64>,
    pub first_failure: Option<String>,
}

impl Counts {
    pub fn merge(&mut self, o: &Counts) {
        self.ok += o.ok;
        self.check_failed += o.check_failed;
        self.errors += o.errors;
        self.bytes += o.bytes;
        for (k, v) in &o.statuses {
            *self.statuses.entry(*k).or_default() += v;
        }
        for (k, v) in &o.error_kinds {
            *self.error_kinds.entry(k.clone()).or_default() += v;
        }
        if self.first_failure.is_none() {
            self.first_failure = o.first_failure.clone();
        }
    }

    pub fn fail(&mut self, msg: String) {
        self.check_failed += 1;
        if self.first_failure.is_none() {
            self.first_failure = Some(msg);
        }
    }

    pub fn error(&mut self, kind: String) {
        self.errors += 1;
        *self.error_kinds.entry(kind.clone()).or_default() += 1;
        if self.first_failure.is_none() {
            self.first_failure = Some(kind);
        }
    }
}
