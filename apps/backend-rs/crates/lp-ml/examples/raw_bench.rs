//! Per-file latency and memory of the in-process RAW thumbnails.
//!
//! `cargo run --release -p lp-ml --example raw_bench -- <dng>... [--repeat N] [--threads T]`
//! (the synthetic DNGs of `tests/ml/raw_samples.py`). Prints, per file, the
//! path Django would take (embedded preview or render), the median latency
//! of that path (decode .. WebP written) and the peak RSS above the idle
//! process; then the throughput of T files rendered at once.

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};

use lp_ml::raw_thumbnail;

fn rss() -> u64 {
    let pid = sysinfo::get_current_pid().unwrap();
    let mut sys = sysinfo::System::new();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[pid]), true);
    sys.process(pid).map(|p| p.memory()).unwrap_or(0)
}

/// Runs `f` while sampling RSS every 2 ms; returns (result, peak RSS).
fn with_peak<R>(f: impl FnOnce() -> R) -> (R, u64) {
    let stop = Arc::new(AtomicBool::new(false));
    let peak = Arc::new(AtomicU64::new(rss()));
    let (s, p) = (stop.clone(), peak.clone());
    let sampler = std::thread::spawn(move || {
        while !s.load(Ordering::Relaxed) {
            p.fetch_max(rss(), Ordering::Relaxed);
            std::thread::sleep(Duration::from_millis(2));
        }
    });
    let r = f();
    peak.fetch_max(rss(), Ordering::Relaxed);
    stop.store(true, Ordering::Relaxed);
    sampler.join().unwrap();
    (r, peak.load(Ordering::Relaxed))
}

fn thumbnail(src: &std::path::Path, out: &std::path::Path) -> &'static str {
    match raw_thumbnail::raw_preview(src, 1080) {
        Some(img) => {
            raw_thumbnail::webp_save(&img, out, 95.0, Some(2)).unwrap();
            "preview"
        }
        None => {
            raw_thumbnail::render_raw(src, out, 1080).unwrap();
            "render"
        }
    }
}

fn main() {
    let mut files = Vec::new();
    let (mut repeat, mut threads) = (5usize, 4usize);
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--repeat" => repeat = args.next().unwrap().parse().unwrap(),
            "--threads" => threads = args.next().unwrap().parse().unwrap(),
            _ => files.push(PathBuf::from(a)),
        }
    }
    let out_dir = tempfile::tempdir().unwrap();
    let idle = rss();
    println!(
        "idle RSS {:.1} MB, rayon threads {}",
        idle as f64 / 1e6,
        rayon::current_num_threads()
    );
    println!(
        "{:24} {:8} {:>9} {:>9} {:>12}",
        "file", "path", "median", "min", "peak RSS +"
    );
    for f in &files {
        let out = out_dir.path().join("x.webp");
        let mut times = Vec::new();
        let mut path = "";
        let mut peak = 0;
        for _ in 0..repeat {
            let t = Instant::now();
            let (p, pk) = with_peak(|| thumbnail(f, &out));
            times.push(t.elapsed());
            path = p;
            peak = peak.max(pk);
        }
        times.sort();
        println!(
            "{:24} {:8} {:>7.0}ms {:>7.0}ms {:>9.1} MB",
            f.file_stem().unwrap().to_string_lossy(),
            path,
            times[times.len() / 2].as_secs_f64() * 1e3,
            times[0].as_secs_f64() * 1e3,
            peak.saturating_sub(idle) as f64 / 1e6
        );
    }
    // Throughput: `threads` renders at once (the scan's workers), sharing
    // rayon's pool for the per-image parallel loops.
    let jobs: Vec<PathBuf> = files
        .iter()
        .cycle()
        .take(files.len() * threads)
        .cloned()
        .collect();
    let t = Instant::now();
    let (_, peak) = with_peak(|| {
        std::thread::scope(|s| {
            for chunk in jobs.chunks(jobs.len().div_ceil(threads)) {
                let dir = out_dir.path().to_path_buf();
                s.spawn(move || {
                    for (i, f) in chunk.iter().enumerate() {
                        let out = dir.join(format!("{:?}-{i}.webp", std::thread::current().id()));
                        thumbnail(f, &out);
                    }
                });
            }
        })
    });
    let secs = t.elapsed().as_secs_f64();
    println!(
        "{} files on {threads} threads: {:.2} s, {:.1} files/s, peak RSS +{:.1} MB",
        jobs.len(),
        secs,
        jobs.len() as f64 / secs,
        peak.saturating_sub(idle) as f64 / 1e6
    );
}
