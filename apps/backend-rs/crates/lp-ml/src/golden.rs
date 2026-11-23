//! Reference outputs of the Python sidecar code, for the in-process ports'
//! tests. Written by `apps/backend-rs/tests/ml/golden_*.py` (see the README
//! there) to `<root>/<service>/<name>.json`:
//!
//! ```json
//! {"service": "clip", "name": "images", "meta": {...},
//!  "cases": [{"id": "...", "input": {...}, "output": {...}}]}
//! ```
//!
//! Arrays are `{"dtype": "float32", "shape": [512], "b64": "<little-endian bytes>"}`.
//! Tests call [`load`] and skip (return early) when it gives `None`, so a
//! machine without goldens or models still passes.

use std::path::{Path, PathBuf};

use base64::Engine;
use serde::Deserialize;
use serde_json::Value;

/// `LP_ML_GOLDENS`, else `rust-pg/ml-goldens` next to the worktree
/// (`<librephotos>/rust-pg/ml-goldens` for `<librephotos>/wt-*`).
pub fn root() -> PathBuf {
    std::env::var_os("LP_ML_GOLDENS")
        .map(PathBuf::from)
        .unwrap_or_else(|| sibling("ml-goldens"))
}

/// `LP_ML_ROOT`, else `rust-pg/ml`: the shared ML `BASE_DATA` for tests;
/// models are under `<it>/protected_media/data_models/<model>`.
pub fn ml_root() -> PathBuf {
    std::env::var_os("LP_ML_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| sibling("ml"))
}

/// `ml_root()/protected_media/data_models`.
pub fn data_models() -> PathBuf {
    ml_root().join("protected_media").join("data_models")
}

fn sibling(name: &str) -> PathBuf {
    // crates/lp-ml -> apps/backend-rs -> apps -> <worktree> -> <librephotos>
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../../..")
        .join("rust-pg")
        .join(name)
}

#[derive(Debug, Clone, Deserialize)]
pub struct Golden {
    pub service: String,
    pub name: String,
    #[serde(default)]
    pub meta: Value,
    pub cases: Vec<Case>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Case {
    pub id: String,
    #[serde(default)]
    pub input: Value,
    #[serde(default)]
    pub output: Value,
}

/// `<root>/<service>/<name>.json`, `None` (with a note on stderr) when absent.
pub fn load(service: &str, name: &str) -> Option<Golden> {
    let path = root().join(service).join(format!("{name}.json"));
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(_) => {
            eprintln!("golden {} missing, skipping", path.display());
            return None;
        }
    };
    Some(serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display())))
}

/// A decoded `{"dtype", "shape", "b64"}` array.
#[derive(Debug, Clone)]
pub struct Array {
    pub dtype: String,
    pub shape: Vec<usize>,
    pub bytes: Vec<u8>,
}

impl Array {
    pub fn from_json(v: &Value) -> Array {
        let dtype = v["dtype"].as_str().expect("array dtype").to_string();
        let shape = v["shape"]
            .as_array()
            .expect("array shape")
            .iter()
            .map(|d| d.as_u64().expect("dim") as usize)
            .collect();
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(v["b64"].as_str().expect("array b64"))
            .expect("base64");
        Array {
            dtype,
            shape,
            bytes,
        }
    }

    pub fn len(&self) -> usize {
        self.shape.iter().product()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn u8(&self) -> &[u8] {
        assert_eq!(self.dtype, "uint8");
        &self.bytes
    }

    pub fn f32(&self) -> Vec<f32> {
        match self.dtype.as_str() {
            "float32" => self
                .bytes
                .chunks_exact(4)
                .map(|c| f32::from_le_bytes(c.try_into().expect("4 bytes")))
                .collect(),
            "float64" => self
                .bytes
                .chunks_exact(8)
                .map(|c| f64::from_le_bytes(c.try_into().expect("8 bytes")) as f32)
                .collect(),
            other => panic!("not a float array: {other}"),
        }
    }

    pub fn i64(&self) -> Vec<i64> {
        match self.dtype.as_str() {
            "int64" => self
                .bytes
                .chunks_exact(8)
                .map(|c| i64::from_le_bytes(c.try_into().expect("8 bytes")))
                .collect(),
            "int32" => self
                .bytes
                .chunks_exact(4)
                .map(|c| i32::from_le_bytes(c.try_into().expect("4 bytes")) as i64)
                .collect(),
            other => panic!("not an int array: {other}"),
        }
    }
}

/// A float list from JSON (`[0.1, 0.2]`) or an encoded array.
pub fn floats(v: &Value) -> Vec<f32> {
    match v {
        Value::Array(a) => a
            .iter()
            .map(|x| x.as_f64().unwrap_or(f64::NAN) as f32)
            .collect(),
        Value::Object(_) => Array::from_json(v).f32(),
        other => panic!("not a float array: {other}"),
    }
}

pub fn cosine(a: &[f32], b: &[f32]) -> f64 {
    assert_eq!(a.len(), b.len(), "vector lengths");
    let (mut dot, mut na, mut nb) = (0f64, 0f64, 0f64);
    for (x, y) in a.iter().zip(b) {
        let (x, y) = (*x as f64, *y as f64);
        dot += x * y;
        na += x * x;
        nb += y * y;
    }
    if na == 0.0 || nb == 0.0 {
        return if na == nb { 1.0 } else { 0.0 };
    }
    dot / (na.sqrt() * nb.sqrt())
}

pub fn max_abs_diff(a: &[f32], b: &[f32]) -> f32 {
    assert_eq!(a.len(), b.len(), "lengths");
    a.iter()
        .zip(b)
        .map(|(x, y)| (x - y).abs())
        .fold(0.0, f32::max)
}

/// (max |a-b|, count of differing bytes).
pub fn u8_diff(a: &[u8], b: &[u8]) -> (u8, usize) {
    assert_eq!(a.len(), b.len(), "lengths");
    let mut max = 0u8;
    let mut n = 0;
    for (x, y) in a.iter().zip(b) {
        let d = x.abs_diff(*y);
        if d > 0 {
            n += 1;
            max = max.max(d);
        }
    }
    (max, n)
}

/// IoU of two `[x1, y1, x2, y2]` boxes.
pub fn iou(a: [f64; 4], b: [f64; 4]) -> f64 {
    let iw = (a[2].min(b[2]) - a[0].max(b[0])).max(0.0);
    let ih = (a[3].min(b[3]) - a[1].max(b[1])).max(0.0);
    let inter = iw * ih;
    let area = |r: [f64; 4]| (r[2] - r[0]).max(0.0) * (r[3] - r[1]).max(0.0);
    let union = area(a) + area(b) - inter;
    if union <= 0.0 { 0.0 } else { inter / union }
}

/// IoU of two `(top, right, bottom, left)` face boxes (the sidecar layout).
pub fn iou_trbl(a: [f64; 4], b: [f64; 4]) -> f64 {
    iou([a[3], a[0], a[1], a[2]], [b[3], b[0], b[1], b[2]])
}

/// Panic with context unless `cosine(a, b) >= min`.
pub fn assert_cosine(a: &[f32], b: &[f32], min: f64, what: &str) {
    let c = cosine(a, b);
    assert!(c >= min, "{what}: cosine {c:.6} < {min}");
}
