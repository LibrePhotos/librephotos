//! Cost of `LP_OCR_PREPASS`: per image, the full pipeline (detection at the
//! bundle's max side + recognition) vs a coarse detection only, split by
//! whether the full pipeline finds text. Gives the break-even share of
//! photos with text.
//!
//! ```bash
//! LP_ORT_LIB=.../onnxruntime.dll ONNX_INTRA_OP_THREADS=4 \
//!   cargo run --release -p lp-ml --example ocr_prepass -- [--side 640] [--model small] <dir>...
//! ```

use std::path::{Path, PathBuf};
use std::time::Instant;

use lp_ml::ocr::ppocr::{Engine, Options, decode};

fn main() -> anyhow::Result<()> {
    let mut side = 640usize;
    let mut model = "small".to_string();
    let mut dirs = Vec::new();
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--side" => side = args.next().expect("--side N").parse()?,
            "--model" => model = args.next().expect("--model NAME"),
            _ => dirs.push(PathBuf::from(a)),
        }
    }
    lp_ml::runtime::init().map_err(|e| anyhow::anyhow!(e))?;
    let dir = lp_ml::golden::data_models()
        .join("ocr")
        .join(format!("ppocrv6_{model}"));
    let mut engine = Engine::load(&dir)?;
    let mut imgs = Vec::new();
    for d in dirs {
        for e in walk(&d) {
            imgs.push(e);
        }
    }
    imgs.sort();
    let (mut n_text, mut n_none) = (0usize, 0usize);
    let (mut full_text, mut full_none, mut pre_text, mut pre_none) = (0.0, 0.0, 0.0, 0.0);
    let mut missed = Vec::new();
    for p in &imgs {
        let Ok(img) = decode::read_image(p) else {
            continue;
        };
        let opts = Options {
            min_confidence: 0.6,
            ..Options::default()
        };
        let t = Instant::now();
        let full = engine.predict_image(&img, opts)?;
        let full_ms = t.elapsed().as_secs_f64() * 1000.0;
        let t = Instant::now();
        let (boxes, _) = engine.detect(&img, side)?;
        let pre_ms = t.elapsed().as_secs_f64() * 1000.0;
        if full.text.trim().is_empty() {
            n_none += 1;
            full_none += full_ms;
            pre_none += pre_ms;
        } else {
            n_text += 1;
            full_text += full_ms;
            pre_text += pre_ms;
            if boxes.is_empty() {
                missed.push(p.file_name().unwrap().to_string_lossy().to_string());
            }
        }
    }
    let f_t = full_text / n_text.max(1) as f64;
    let f_n = full_none / n_none.max(1) as f64;
    let p_t = pre_text / n_text.max(1) as f64;
    let p_n = pre_none / n_none.max(1) as f64;
    // With text share s: today s*f_t + (1-s)*f_n; prepass s*(p_t+f_t) + (1-s)*p_n.
    let breakeven = (f_n - p_n) / (p_t + f_n - p_n);
    println!(
        "{} images ({n_text} with text, {n_none} without), prepass side {side}\n\
         full pipeline: {f_t:.0} ms with text, {f_n:.0} ms without\n\
         prepass:       {p_t:.0} ms with text, {p_n:.0} ms without\n\
         text photos the prepass misses: {} {missed:?}\n\
         prepass pays off below {:.0}% photos with text",
        n_text + n_none,
        missed.len(),
        breakeven * 100.0
    );
    Ok(())
}

fn walk(d: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![d.to_path_buf()];
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
    out
}
