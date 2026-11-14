//! Session load time per model: as today (graph optimisation at every load)
//! vs a pre-optimised copy (`with_optimized_model_path` once, then loaded
//! with optimisation off), and each level's first-run latency.
//!
//! ```bash
//! LP_ORT_LIB=.../onnxruntime.dll ONNX_INTRA_OP_THREADS=4 \
//!   cargo run --release -p lp-ml --example ort_load -- [--rounds 3] <model.onnx>...
//! ```

use std::path::PathBuf;
use std::time::Instant;

use ort::session::builder::GraphOptimizationLevel;

fn main() -> anyhow::Result<()> {
    let mut rounds = 3usize;
    let mut models = Vec::new();
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--rounds" => rounds = args.next().expect("--rounds N").parse()?,
            _ => models.push(PathBuf::from(a)),
        }
    }
    lp_ml::runtime::init().map_err(|e| anyhow::anyhow!(e))?;
    let tmp = tempfile::tempdir()?;
    for model in models {
        let name = model.display().to_string();
        let mut plain = Vec::new();
        for _ in 0..rounds {
            let t = Instant::now();
            let s = lp_ml::runtime::session(&model)?;
            plain.push(t.elapsed().as_secs_f64() * 1000.0);
            drop(s);
        }
        for (label, level) in [
            ("basic", GraphOptimizationLevel::Level1),
            ("extended", GraphOptimizationLevel::Level2),
            ("all", GraphOptimizationLevel::Level3),
        ] {
            let opt = tmp.path().join(format!(
                "{}.{label}.onnx",
                model.file_stem().unwrap().to_string_lossy()
            ));
            let t = Instant::now();
            let s = lp_ml::runtime::session_builder()?
                .with_optimization_level(level)
                .map_err(|e| anyhow::anyhow!("{e}"))?
                .with_optimized_model_path(&opt)
                .map_err(|e| anyhow::anyhow!("{e}"))?
                .commit_from_file(&model)?;
            let save_ms = t.elapsed().as_secs_f64() * 1000.0;
            drop(s);
            let mut pre = Vec::new();
            for _ in 0..rounds {
                let t = Instant::now();
                let s = lp_ml::runtime::session_builder()?
                    .with_optimization_level(GraphOptimizationLevel::Disable)
                    .map_err(|e| anyhow::anyhow!("{e}"))?
                    .commit_from_file(&opt)?;
                pre.push(t.elapsed().as_secs_f64() * 1000.0);
                drop(s);
            }
            println!(
                "{name}: as today {plain:.0?} ms; {label}: optimise+save {save_ms:.0} ms, \
                 then load {pre:.0?} ms ({:.1} MB on disk)",
                std::fs::metadata(&opt)?.len() as f64 / 1e6
            );
        }
    }
    Ok(())
}
