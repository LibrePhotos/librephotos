//! W1: closed-loop concurrency against one URL, every response checked.

use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::check::Check;
use crate::http;
use crate::procstat::{self, SampleSummary, TreeStat};
use crate::stats::{self, Counts, Latency};

pub struct Opts {
    pub base: String,
    pub path: String,
    pub token: String,
    pub concurrency: usize,
    pub warmup: Duration,
    pub duration: Duration,
    pub check: Check,
    pub server_pids: Vec<u32>,
    pub pg_pids: Vec<u32>,
    pub timeout_s: u64,
}

#[derive(Serialize)]
pub struct Report {
    pub path: String,
    pub concurrency: usize,
    pub duration_s: f64,
    pub rps: f64,
    pub latency: Latency,
    pub counts: Counts,
    pub bytes_per_response: f64,
    pub server_cpu_s: f64,
    pub pg_cpu_s: f64,
    pub client_cpu_s: f64,
    pub server_before: TreeStat,
    pub server_rss: SampleSummary,
}

pub async fn run(o: Opts) -> Report {
    let client = http::client(o.concurrency * 2, o.timeout_s);
    let o = Arc::new(o);
    let start = Instant::now();
    let measure_from = start + o.warmup;
    let end = measure_from + o.duration;

    // Measurement window bookkeeping starts when the warm-up ends.
    let o2 = o.clone();
    let window = tokio::spawn(async move {
        tokio::time::sleep_until(measure_from.into()).await;
        let before = procstat::tree_stat(&o2.server_pids);
        let pg0 = procstat::tree_stat(&o2.pg_pids).cpu_s;
        let me0 = procstat::self_cpu();
        let sampler = procstat::Sampler::start(o2.server_pids.clone(), Duration::from_millis(500));
        tokio::time::sleep_until(end.into()).await;
        let after = procstat::tree_stat(&o2.server_pids);
        let pg1 = procstat::tree_stat(&o2.pg_pids).cpu_s;
        let me1 = procstat::self_cpu();
        (before, after.cpu_s - before.cpu_s, pg1 - pg0, me1 - me0, sampler.finish())
    });

    let mut tasks = Vec::new();
    for _ in 0..o.concurrency {
        let (c, o) = (client.clone(), o.clone());
        tasks.push(tokio::spawn(async move {
            let mut h = stats::hist();
            let mut counts = Counts::default();
            loop {
                let now = Instant::now();
                if now >= end {
                    break;
                }
                let r = http::get(&c, &o.base, &o.path, &o.token).await;
                let done = Instant::now();
                // Only requests that both start and finish inside the window count.
                if now < measure_from || done > end {
                    continue;
                }
                match r {
                    Ok(r) => {
                        *counts.statuses.entry(r.status).or_default() += 1;
                        counts.bytes += r.body.len() as u64;
                        match o.check.verify(r.status, &r.body) {
                            Ok(()) => {
                                counts.ok += 1;
                                stats::record(&mut h, r.latency);
                            }
                            Err(e) => counts.fail(e),
                        }
                    }
                    Err(kind) => counts.error(kind),
                }
            }
            (h, counts)
        }));
    }
    let mut h = stats::hist();
    let mut counts = Counts::default();
    for t in tasks {
        let (th, tc) = t.await.expect("load task");
        h.add(&th).ok();
        counts.merge(&tc);
    }
    let (before, server_cpu, pg_cpu, client_cpu, rss) = window.await.expect("window task");
    let secs = o.duration.as_secs_f64();
    let responses = counts.ok + counts.check_failed;
    Report {
        path: o.path.clone(),
        concurrency: o.concurrency,
        duration_s: secs,
        rps: counts.ok as f64 / secs,
        latency: stats::summarize(&h),
        bytes_per_response: if responses > 0 { counts.bytes as f64 / responses as f64 } else { 0.0 },
        counts,
        server_cpu_s: server_cpu,
        pg_cpu_s: pg_cpu,
        client_cpu_s: client_cpu,
        server_before: before,
        server_rss: rss,
    }
}
