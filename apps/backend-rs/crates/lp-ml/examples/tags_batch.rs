//! MobileCLIP-S2 image tower through `Tagger::predict_batch` at several batch
//! sizes, ms per image, on the configured provider (round 3 #17).
//!
//! ```bash
//! LP_ORT_LIB=.../onnxruntime.dll ONNX_PROVIDERS=dml cargo run --release -p lp-ml --example tags_batch
//! ```

use std::time::Instant;

use lp_ml::golden;
use lp_ml::tags::tagger::{MAX_TAGS, Model, Tagger};

fn main() -> anyhow::Result<()> {
    let model = Model::MobileClipS2;
    let dir = golden::data_models().join(model.name());
    let mut t = Tagger::load(model, &dir)?;
    let size = 256;
    let img: Vec<f32> = (0..3 * size * size)
        .map(|i| (i % 255) as f32 / 255.0)
        .collect();
    let sizes: Vec<usize> = std::env::args()
        .nth(1)
        .map(|s| s.split(',').filter_map(|x| x.parse().ok()).collect())
        .unwrap_or_else(|| vec![1, 2, 4, 8, 16, 17, 23, 24, 32, 1, 16, 32]);
    for &n in &sizes {
        let batch = vec![img.clone(); n];
        let warm = Instant::now();
        t.predict_batch(size, &batch, model.threshold(), MAX_TAGS)?;
        let first = warm.elapsed().as_secs_f64() * 1000.0;
        let reps = (64 / n).max(3);
        let s = Instant::now();
        for _ in 0..reps {
            t.predict_batch(size, &batch, model.threshold(), MAX_TAGS)?;
        }
        let ms = s.elapsed().as_secs_f64() * 1000.0 / (reps * n) as f64;
        println!("batch {n:>3}: first run {first:8.1} ms, then {ms:6.2} ms per image");
    }
    Ok(())
}
