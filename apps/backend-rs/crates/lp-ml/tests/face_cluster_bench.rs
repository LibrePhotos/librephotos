//! Throughput of the in-process face clustering on synthetic libraries
//! (512-d unit vectors around random identities, like ArcFace encodings):
//!
//! ```text
//! LP_FC_BENCH=5000,50000 cargo test -p lp-ml --test face_cluster_bench -- --ignored --nocapture
//! ```
//!
//! Prints wall time and the process RSS (current and peak while running)
//! for HDBSCAN with Django's parameters for that size, and for the two
//! MLPClassifier fits + predictions of `train_faces`.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};

use lp_ml::face_cluster::hdbscan::{self, Params};
use lp_ml::face_cluster::mlp::Mlp;
use ndarray::Array2;

struct Rng(u64);

impl Rng {
    fn next(&mut self) -> f64 {
        // splitmix64
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        ((z ^ (z >> 31)) >> 11) as f64 / (1u64 << 53) as f64
    }

    fn normal(&mut self) -> f64 {
        let (u, v) = (self.next().max(1e-300), self.next());
        (-2.0 * u.ln()).sqrt() * (2.0 * std::f64::consts::PI * v).cos()
    }
}

fn unit(v: &mut [f64]) {
    let n = v.iter().map(|x| x * x).sum::<f64>().sqrt();
    v.iter_mut().for_each(|x| *x /= n);
}

/// `n` faces of `n / 20` identities (sizes 1..=39) plus 10% noise.
fn library(n: usize, d: usize, seed: u64) -> (Vec<f64>, Vec<i64>) {
    let mut rng = Rng(seed);
    let ids = (n / 20).max(1);
    let centers: Vec<Vec<f64>> = (0..ids)
        .map(|_| {
            let mut c: Vec<f64> = (0..d).map(|_| rng.normal()).collect();
            unit(&mut c);
            c
        })
        .collect();
    let mut data = Vec::with_capacity(n * d);
    let mut truth = Vec::with_capacity(n);
    for i in 0..n {
        let noise = rng.next() < 0.1;
        let id = (rng.next() * ids as f64) as usize % ids;
        let mut p: Vec<f64> = if noise {
            (0..d).map(|_| rng.normal()).collect()
        } else {
            centers[id]
                .iter()
                .map(|c| c + rng.normal() * 0.9 / (d as f64).sqrt())
                .collect()
        };
        unit(&mut p);
        data.extend(p);
        truth.push(if noise { -1 } else { id as i64 });
        let _ = i;
    }
    (data, truth)
}

fn rss() -> u64 {
    let mut sys = sysinfo::System::new();
    let pid = sysinfo::get_current_pid().unwrap();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[pid]), true);
    sys.process(pid).map_or(0, |p| p.memory())
}

/// Runs `f`, sampling the process every 100 ms: (result, wall seconds,
/// peak RSS, CPU seconds integrated from sysinfo's usage samples). The CPU
/// time is what the work costs on a loaded machine where wall time lies.
fn measured<T>(f: impl FnOnce() -> T) -> (T, f64, u64, f64) {
    let stop = Arc::new(AtomicBool::new(false));
    let peak = Arc::new(AtomicU64::new(rss()));
    let cpu_ms = Arc::new(AtomicU64::new(0));
    let sampler = {
        let (stop, peak, cpu_ms) = (stop.clone(), peak.clone(), cpu_ms.clone());
        std::thread::spawn(move || {
            let mut sys = sysinfo::System::new();
            let pid = sysinfo::get_current_pid().unwrap();
            let mut last = Instant::now();
            while !stop.load(Ordering::Relaxed) {
                std::thread::sleep(Duration::from_millis(100));
                sys.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[pid]), true);
                if let Some(p) = sys.process(pid) {
                    peak.fetch_max(p.memory(), Ordering::Relaxed);
                    let dt = last.elapsed().as_secs_f64();
                    cpu_ms.fetch_add(
                        (p.cpu_usage() as f64 / 100.0 * dt * 1000.0) as u64,
                        Ordering::Relaxed,
                    );
                }
                last = Instant::now();
            }
        })
    };
    let t = Instant::now();
    let out = f();
    let secs = t.elapsed().as_secs_f64();
    stop.store(true, Ordering::Relaxed);
    sampler.join().unwrap();
    peak.fetch_max(rss(), Ordering::Relaxed);
    (
        out,
        secs,
        peak.load(Ordering::Relaxed),
        cpu_ms.load(Ordering::Relaxed) as f64 / 1000.0,
    )
}

const MB: f64 = 1024.0 * 1024.0;

/// Prints lp-ml's debug events (HDBSCAN phases, Prim progress) with the
/// time since start, so a run cut off by a time limit still says how far
/// it got.
struct Progress(Instant);

impl tracing::Subscriber for Progress {
    fn enabled(&self, m: &tracing::Metadata<'_>) -> bool {
        m.target().starts_with("lp_ml")
    }
    fn new_span(&self, _: &tracing::span::Attributes<'_>) -> tracing::span::Id {
        tracing::span::Id::from_u64(1)
    }
    fn record(&self, _: &tracing::span::Id, _: &tracing::span::Record<'_>) {}
    fn record_follows_from(&self, _: &tracing::span::Id, _: &tracing::span::Id) {}
    fn event(&self, e: &tracing::Event<'_>) {
        struct Line(String);
        impl tracing::field::Visit for Line {
            fn record_debug(&mut self, f: &tracing::field::Field, v: &dyn std::fmt::Debug) {
                self.0.push_str(&format!(" {}={v:?}", f.name()));
            }
        }
        let mut line = Line(String::new());
        e.record(&mut line);
        eprintln!("  [{:7.1}s]{}", self.0.elapsed().as_secs_f64(), line.0);
    }
    fn enter(&self, _: &tracing::span::Id) {}
    fn exit(&self, _: &tracing::span::Id) {}
}

#[test]
#[ignore]
fn bench_face_cluster() {
    let sizes: Vec<usize> = std::env::var("LP_FC_BENCH")
        .unwrap_or_else(|_| "5000".into())
        .split(',')
        .map(|s| s.trim().parse().unwrap())
        .collect();
    let train_max: usize = std::env::var("LP_FC_BENCH_TRAIN_MAX")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(usize::MAX);
    let d = 512;
    let _ = tracing::subscriber::set_global_default(Progress(Instant::now()));
    eprintln!(
        "rayon threads {}, base RSS {:.0} MB",
        rayon::current_num_threads(),
        rss() as f64 / MB
    );
    for n in sizes {
        let (data, truth) = library(n, d, n as u64);
        let base = rss();
        let mcs = match n {
            n if n > 100_000 => 16,
            n if n > 10_000 => 8,
            n if n > 1_000 => 4,
            _ => 2,
        };
        let params = Params {
            min_cluster_size: mcs,
            min_samples: 1,
            cluster_selection_epsilon: 0.05,
        };
        // LP_FC_BENCH_SKIP_HDBSCAN: train on the true identities instead.
        let skip = std::env::var_os("LP_FC_BENCH_SKIP_HDBSCAN").is_some();
        let (labels, secs, peak, cpu) = if skip {
            (truth.clone(), 0.0, base, 0.0)
        } else {
            measured(|| hdbscan::labels(&data, d, &params).unwrap())
        };
        let clusters = labels
            .iter()
            .filter(|l| **l >= 0)
            .max()
            .map_or(0, |m| m + 1);
        let noise = labels.iter().filter(|l| **l < 0).count();
        eprintln!(
            "hdbscan n={n} d={d} mcs={mcs}: {secs:.2}s wall, {cpu:.1}s CPU ({:.1} us/face), {clusters} clusters, {noise} noise, true ids {}, peak RSS +{:.0} MB over the {:.0} MB input",
            secs * 1e6 / n as f64,
            truth.iter().filter(|t| **t >= 0).max().map_or(0, |m| m + 1),
            peak.saturating_sub(base) as f64 / MB,
            (n * d * 8) as f64 / MB,
        );

        if n > train_max {
            continue;
        }
        // train_faces: 40% of the faces labelled with their identity, the
        // clusters' centroids as extra classes, the rest predicted.
        let mut known = Vec::new();
        let mut known_ids = Vec::new();
        let mut unknown = Vec::new();
        for (i, t) in truth.iter().enumerate() {
            let row = &data[i * d..(i + 1) * d];
            if *t >= 0 && (*t as usize) % 5 < 2 && i % 5 < 4 {
                known.extend_from_slice(row);
                known_ids.push(*t);
            } else {
                unknown.extend_from_slice(row);
            }
        }
        let mut centroids: Vec<(i64, Vec<f64>)> = Vec::new();
        for c in 0..clusters {
            let members: Vec<usize> = (0..n).filter(|i| labels[*i] == c).collect();
            let mut mean = vec![0.0; d];
            for m in &members {
                mean.iter_mut()
                    .zip(&data[m * d..(m + 1) * d])
                    .for_each(|(a, b)| *a += b);
            }
            mean.iter_mut().for_each(|a| *a /= members.len() as f64);
            centroids.push((1_000_000 + c, mean));
        }
        let nk = known_ids.len();
        let known_x = Array2::from_shape_vec((nk, d), known.clone()).unwrap();
        let mut all = known;
        let mut all_ids = known_ids.clone();
        for (id, m) in &centroids {
            all.extend_from_slice(m);
            all_ids.push(*id);
        }
        let all_x = Array2::from_shape_vec((all_ids.len(), d), all).unwrap();
        let nu = unknown.len() / d;
        let unknown_x = Array2::from_shape_vec((nu, d), unknown).unwrap();
        let base = rss();
        let ((a, b), secs, peak, cpu) = measured(|| {
            let (a, b) = rayon::join(
                || Mlp::fit(known_x.view(), &known_ids).unwrap(),
                || Mlp::fit(all_x.view(), &all_ids).unwrap(),
            );
            for page in 0..nu.div_ceil(100) {
                let rows = unknown_x.slice(ndarray::s![page * 100..((page + 1) * 100).min(nu), ..]);
                std::hint::black_box((a.predict_proba(rows), b.predict_proba(rows)));
            }
            (a, b)
        });
        eprintln!(
            "train n={n}: classifier {nk} faces / {} classes ({} epochs), cluster classifier {} rows / {} classes ({} epochs), {nu} predicted: {secs:.2}s wall, {cpu:.1}s CPU, peak RSS +{:.0} MB",
            a.classes.len(),
            a.n_iter,
            all_ids.len(),
            b.classes.len(),
            b.n_iter,
            peak.saturating_sub(base) as f64 / MB,
        );
    }
}
