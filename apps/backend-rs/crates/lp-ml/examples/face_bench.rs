//! Throughput and memory of the in-process face service.
//!
//! ```bash
//! LP_ORT_LIB=.../onnxruntime.dll cargo run --release -p lp-ml --example face_bench -- \
//!     [--model buffalo_sc] [--rounds 3] <image>...
//! ```
//!
//! Loads the pack (reports the resident-set delta of loading and of the first
//! inference), then runs detection + embedding of every face (what
//! `/face-locations` does) over the images `rounds` times.

use std::path::PathBuf;
use std::time::Instant;

use lp_ml::face::{FacePack, Want};

fn rss_mb() -> f64 {
    let mut sys = sysinfo::System::new();
    let pid = sysinfo::get_current_pid().expect("pid");
    sys.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[pid]), true);
    sys.process(pid)
        .map(|p| p.memory() as f64 / 1e6)
        .unwrap_or(0.0)
}

fn main() -> anyhow::Result<()> {
    let mut model = "buffalo_sc".to_string();
    let mut rounds = 3usize;
    let mut images = Vec::new();
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--model" => model = args.next().expect("--model NAME"),
            "--rounds" => rounds = args.next().expect("--rounds N").parse()?,
            _ => images.push(PathBuf::from(a)),
        }
    }
    let dir = lp_ml::golden::data_models()
        .join("face_recognition/models")
        .join(&model);

    let base = rss_mb();
    let info = lp_ml::runtime::init().map_err(anyhow::Error::msg)?;
    let after_runtime = rss_mb();
    let t = Instant::now();
    let mut pack = FacePack::load(&dir)?;
    let load_s = t.elapsed().as_secs_f64();
    let after_load = rss_mb();

    let decoded: Vec<_> = images
        .iter()
        .map(|p| lp_ml::preprocess::load_rgb(p))
        .collect::<Result<_, _>>()?;
    let decoded_mb = rss_mb();
    let first = Instant::now();
    pack.analyze(&decoded[0], Want::All)?;
    let first_s = first.elapsed().as_secs_f64();
    let after_first = rss_mb();

    let mut faces = 0usize;
    let mut det_only = 0f64;
    let t = Instant::now();
    for _ in 0..rounds {
        for img in &decoded {
            faces += pack.analyze(img, Want::All)?.len();
        }
    }
    let total = t.elapsed().as_secs_f64();
    // Detection alone (Matching nothing: no embeddings).
    let t2 = Instant::now();
    for img in &decoded {
        pack.analyze(img, Want::Matching(Vec::new()))?;
    }
    det_only += t2.elapsed().as_secs_f64();
    let peak = rss_mb();

    let n = rounds * decoded.len();
    println!("runtime: {} ({:?})", info.lib.display(), info.intra_threads);
    println!("model {model}: load {load_s:.2}s, first image {first_s:.2}s");
    println!(
        "RSS MB: start {base:.0}, +runtime {:.0}, +pack {:.0}, (+images {:.0}), +first inference {:.0}, end {peak:.0}",
        after_runtime - base,
        after_load - after_runtime,
        decoded_mb - after_load,
        after_first - decoded_mb
    );
    println!(
        "{n} images, {faces} faces in {total:.2}s: {:.1} ms/image, {:.1} images/s; \
         detection alone {:.1} ms/image; embedding {:.1} ms/face",
        total * 1000.0 / n as f64,
        n as f64 / total,
        det_only * 1000.0 / decoded.len() as f64,
        if faces > 0 {
            (total - det_only * rounds as f64) * 1000.0 / faces as f64
        } else {
            0.0
        }
    );
    Ok(())
}
