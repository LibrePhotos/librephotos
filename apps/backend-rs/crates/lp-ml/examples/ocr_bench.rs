//! In-process PP-OCRv6: resident memory of a loaded bundle and per-image
//! latency, `cargo run -p lp-ml --release --example ocr_bench -- [tiny|small|medium ...]`
//! (`LP_ORT_LIB` must point at the runtime library; images: the OCR goldens'
//! `_images/ocr` plus the fixture's stills, as `tests/ml/golden_ocr.py` made them).

use std::path::PathBuf;
use std::time::Instant;

use lp_ml::ocr::ppocr::{Engine, Options, decode, warp};
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

fn images() -> Vec<PathBuf> {
    let mut out = Vec::new();
    let goldens = lp_ml::golden::root().join("_images").join("ocr");
    let fixture = lp_ml::golden::ml_root()
        .join("..")
        .join("fixture")
        .join("data");
    for dir in [goldens, fixture] {
        let mut stack = vec![dir];
        while let Some(d) = stack.pop() {
            let Ok(rd) = std::fs::read_dir(&d) else {
                continue;
            };
            for e in rd.flatten() {
                let p = e.path();
                if p.is_dir() {
                    stack.push(p);
                } else if matches!(
                    p.extension()
                        .and_then(|e| e.to_str())
                        .map(str::to_ascii_lowercase)
                        .as_deref(),
                    Some("jpg" | "jpeg" | "png" | "webp")
                ) {
                    out.push(p);
                }
            }
        }
    }
    out.sort();
    out
}

fn ms(t: Instant) -> f64 {
    t.elapsed().as_secs_f64() * 1000.0
}

fn main() -> anyhow::Result<()> {
    let tiers: Vec<String> = {
        let a: Vec<String> = std::env::args().skip(1).collect();
        if a.is_empty() {
            vec!["tiny".into(), "small".into()]
        } else {
            a
        }
    };
    let pid = Pid::from_u32(std::process::id());
    let mut sys = System::new();
    let base = rss_mb(&mut sys, pid);
    lp_ml::runtime::init().map_err(|e| anyhow::anyhow!(e))?;
    drop(lp_ml::runtime::session_builder()?);
    let ort = rss_mb(&mut sys, pid);
    println!("baseline {base:.1} MB, ORT loaded {ort:.1} MB");
    let imgs = images();
    println!("{} images", imgs.len());
    for tier in tiers {
        let dir = lp_ml::golden::data_models()
            .join("ocr")
            .join(format!("ppocrv6_{tier}"));
        let before = rss_mb(&mut sys, pid);
        let t = Instant::now();
        let mut engine = Engine::load(&dir)?;
        let load_ms = ms(t);
        let loaded = rss_mb(&mut sys, pid);
        let (mut dec, mut det, mut crop, mut rec, mut total) = (0.0, 0.0, 0.0, 0.0, Vec::new());
        let mut peak = loaded;
        let mut chars = 0usize;
        let max_side = engine.config.det_max_side;
        for p in &imgs {
            let t0 = Instant::now();
            let img = decode::read_image(p)?;
            dec += ms(t0);
            let t1 = Instant::now();
            let (boxes, _) = engine.detect(&img, max_side)?;
            det += ms(t1);
            let t2 = Instant::now();
            let crops: Vec<_> = boxes.iter().map(|q| warp::rotate_crop(&img, q)).collect();
            crop += ms(t2);
            let t3 = Instant::now();
            let r = engine.recognize(&crops)?;
            rec += ms(t3);
            chars += r.iter().map(|(t, _)| t.chars().count()).sum::<usize>();
            total.push(ms(t0));
            peak = peak.max(rss_mb(&mut sys, pid));
        }
        // the public path once more, end to end
        let t = Instant::now();
        for p in &imgs {
            engine.predict(p, Options::default())?;
        }
        let e2e = ms(t) / imgs.len() as f64;
        let after = rss_mb(&mut sys, pid);
        drop(engine);
        lp_ml::slot::release_memory();
        let unloaded = rss_mb(&mut sys, pid);
        total.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let n = imgs.len() as f64;
        println!(
            "ppocrv6_{tier}: load {load_ms:.0} ms, RSS +{:.1} MB loaded, +{:.1} MB peak while running, +{:.1} MB after, {:.1} MB left after unload",
            loaded - before,
            peak - before,
            after - before,
            unloaded - before
        );
        println!(
            "  per image: mean {:.1} ms, median {:.1} ms, p90 {:.1} ms (decode {:.1}, detect {:.1}, crops {:.1}, recognize {:.1}); predict() {e2e:.1} ms; {chars} chars",
            total.iter().sum::<f64>() / n,
            total[total.len() / 2],
            total[total.len() * 9 / 10],
            dec / n,
            det / n,
            crop / n,
            rec / n
        );
    }
    Ok(())
}
