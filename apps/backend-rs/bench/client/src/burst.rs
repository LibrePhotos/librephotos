//! W3: the thumbnail burst the timeline fires on first paint, time to last byte.

use std::sync::Arc;
use std::time::{Duration, Instant};

use futures::future::join_all;
use serde::Serialize;
use tokio::sync::Semaphore;

use crate::http;
use crate::stats::{self, Counts, Latency};

#[derive(Serialize)]
pub struct Rep {
    pub ttlb_ms: f64,
    pub bytes: u64,
    pub request_latency: Latency,
    pub counts: Counts,
}

/// `n` GETs of /media/<kind>/<hash>, at most `conns` in flight, on a fresh
/// connection pool (a page load opens its own connections).
pub async fn run(base: &str, token: &str, kind: &str, hashes: &[String], conns: usize) -> Rep {
    let client = http::client(conns, 60);
    let sem = Arc::new(Semaphore::new(conns));
    let t0 = Instant::now();
    let results = join_all(hashes.iter().map(|h| {
        let (client, sem) = (client.clone(), sem.clone());
        let path = format!("/media/{kind}/{h}");
        async move {
            let _p = sem.acquire().await.unwrap();
            http::get(&client, base, &path, token).await
        }
    }))
    .await;
    let ttlb = t0.elapsed();
    let mut h = stats::hist();
    let mut counts = Counts::default();
    for r in results {
        match r {
            Ok(r) => {
                *counts.statuses.entry(r.status).or_default() += 1;
                counts.bytes += r.body.len() as u64;
                if r.status == 200 && !r.body.is_empty() {
                    counts.ok += 1;
                    stats::record(&mut h, r.latency);
                } else {
                    counts.fail(format!("status {} bytes {}", r.status, r.body.len()));
                }
            }
            Err(k) => counts.error(k),
        }
    }
    Rep { ttlb_ms: dur_ms(ttlb), bytes: counts.bytes, request_latency: stats::summarize(&h), counts }
}

fn dur_ms(d: Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}
