//! Seconds per caption and resident memory of the in-process LFM2.5-VL
//! captioner: `cargo run -p lp-ml --example caption_bench -- <model dir> <image>...`
//! (`LP_ORT_LIB` must point at the runtime library). The Python twin is
//! `tests/ml/bench_caption.py`; run them one after the other on the same images.

use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};

use lp_ml::caption::lfm2_vl::{DEFAULT_MAX_NEW_TOKENS, DEFAULT_PROMPT, Lfm2Vl};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

fn rss_mb(sys: &mut System, pid: Pid) -> f64 {
    sys.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[pid]),
        true,
        ProcessRefreshKind::nothing().with_memory(),
    );
    sys.process(pid)
        .map_or(0.0, |p| p.memory() as f64 / 1_048_576.0)
}

fn main() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(1);
    let dir = args.next().expect("model dir");
    let images: Vec<String> = args.collect();
    let pid = Pid::from_u32(std::process::id());
    let mut sys = System::new();

    let peak = Arc::new(AtomicU64::new(0));
    let stop = Arc::new(AtomicBool::new(false));
    let sampler = {
        let (peak, stop) = (peak.clone(), stop.clone());
        std::thread::spawn(move || {
            let mut sys = System::new();
            while !stop.load(Ordering::Relaxed) {
                let kb = (rss_mb(&mut sys, pid) * 1024.0) as u64;
                peak.fetch_max(kb, Ordering::Relaxed);
                std::thread::sleep(Duration::from_millis(20));
            }
        })
    };

    let base = rss_mb(&mut sys, pid);
    lp_ml::runtime::init().map_err(|e| anyhow::anyhow!(e))?;
    let ort = rss_mb(&mut sys, pid);
    let t = Instant::now();
    let mut m = Lfm2Vl::load(Path::new(&dir))?;
    let load_secs = t.elapsed().as_secs_f64();
    let loaded = rss_mb(&mut sys, pid);
    println!(
        "rust baseline {base:.1} MB, ORT {ort:.1} MB, model loaded {loaded:.1} MB (load {load_secs:.2} s)"
    );

    let (mut secs, mut tokens) = (0.0, 0usize);
    for img in &images {
        let t = Instant::now();
        let rgb = lp_ml::preprocess::load_rgb(Path::new(img))?;
        let g = m.generate(&rgb, DEFAULT_PROMPT, DEFAULT_MAX_NEW_TOKENS)?;
        let s = t.elapsed().as_secs_f64();
        secs += s;
        tokens += g.token_ids.len();
        println!(
            "rust {s:6.2} s {:3} tok {:4} img tok  {}",
            g.token_ids.len(),
            g.image_tokens,
            g.caption
        );
    }
    stop.store(true, Ordering::Relaxed);
    sampler.join().ok();
    let after = rss_mb(&mut sys, pid);
    println!(
        "rust mean {:.2} s/caption, {:.1} tok/s; RSS after {after:.1} MB, peak {:.1} MB; model delta {:.1} MB (peak {:.1} MB over ORT)",
        secs / images.len().max(1) as f64,
        tokens as f64 / secs.max(1e-9),
        peak.load(Ordering::Relaxed) as f64 / 1024.0,
        loaded - ort,
        peak.load(Ordering::Relaxed) as f64 / 1024.0 - ort,
    );
    Ok(())
}
