//! Face detection recall of the `LP_FACE_DET_SIZE` modes against the
//! Python goldens (insightface, `det_size=640`) of the buffalo_sc, e2e and
//! edge sets: faces found (IoU >= 0.5 with a golden face), extra faces,
//! embedding cosine of the faces both find, detection time.
//!
//! ```bash
//! LP_ORT_LIB=.../onnxruntime.dll cargo run --release -p lp-ml --example face_det_sizes
//! ```

use std::path::Path;
use std::time::Instant;

use lp_ml::face::{DetSize, FacePack, Want};
use lp_ml::golden::{self, Array};

fn main() -> anyhow::Result<()> {
    let dir = golden::data_models().join("face_recognition/models/buffalo_sc");
    let mut pack = FacePack::load(&dir)?;
    let mut cases = Vec::new();
    for set in ["buffalo_sc", "e2e", "edge"] {
        let Some(g) = golden::load("face", set) else {
            eprintln!("no golden set {set}");
            continue;
        };
        for c in g.cases {
            let Some(src) = c.input.get("source").and_then(|s| s.as_str()) else {
                continue;
            };
            let Some(locs) = c.output.get("face_locations").and_then(|l| l.as_array()) else {
                continue;
            };
            let want: Vec<[i32; 4]> = locs
                .iter()
                .map(|v| {
                    let a: Vec<i32> = v
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|x| x.as_i64().unwrap() as i32)
                        .collect();
                    [a[0], a[1], a[2], a[3]]
                })
                .collect();
            let enc: Vec<Option<Vec<f32>>> = (0..want.len())
                .map(|i| {
                    c.output
                        .get("encodings")
                        .and_then(|e| e.get(i))
                        .filter(|e| !e.is_null())
                        .map(|e| Array::from_json(e).f32())
                })
                .collect();
            let Ok(image) = lp_ml::preprocess::load_rgb(Path::new(src)) else {
                continue;
            };
            cases.push((format!("{set}/{}", c.id), image, want, enc));
        }
    }
    println!(
        "{} images, {} golden faces",
        cases.len(),
        cases.iter().map(|c| c.2.len()).sum::<usize>()
    );
    for mode in [
        DetSize::Fixed(640),
        DetSize::Fixed(480),
        DetSize::Fixed(320),
        DetSize::Auto,
    ] {
        pack.det_size = mode;
        let (mut found, mut total, mut extra) = (0, 0, 0);
        let mut cos: Vec<f64> = Vec::new();
        let mut misses = Vec::new();
        let t = Instant::now();
        for (id, image, want, enc) in &cases {
            let faces = pack.analyze(image, Want::All)?;
            total += want.len();
            let mut used = vec![false; faces.len()];
            for (wi, w) in want.iter().enumerate() {
                let best = faces
                    .iter()
                    .enumerate()
                    .filter(|(i, _)| !used[*i])
                    .map(|(i, f)| {
                        (
                            i,
                            golden::iou_trbl(w.map(f64::from), f.location.map(f64::from)),
                        )
                    })
                    .max_by(|a, b| a.1.total_cmp(&b.1));
                match best {
                    Some((i, iou)) if iou >= 0.5 => {
                        used[i] = true;
                        found += 1;
                        if let (Some(e), Some(g)) = (&enc[wi], &faces[i].embedding) {
                            cos.push(golden::cosine(e, g));
                        }
                    }
                    _ => misses.push(id.clone()),
                }
            }
            extra += used.iter().filter(|u| !**u).count();
        }
        let secs = t.elapsed().as_secs_f64();
        cos.sort_by(f64::total_cmp);
        println!(
            "{mode:?}: found {found}/{total}, extra {extra}, cosine min {:.4} mean {:.4}, {:.1} ms/image; missed in {:?}",
            cos.first().copied().unwrap_or(f64::NAN),
            cos.iter().sum::<f64>() / cos.len().max(1) as f64,
            secs * 1000.0 / cases.len() as f64,
            misses
        );
    }
    Ok(())
}
