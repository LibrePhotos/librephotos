//! A PP-OCRv6 bundle (`det.onnx`, `rec.onnx`, `charset.txt`, `config.json`),
//! parsed like `ppocr/config.py`.

use std::path::{Path, PathBuf};

use anyhow::{Context, bail};
use serde::Deserialize;

#[derive(Debug, Clone)]
pub struct OcrConfig {
    pub dir: PathBuf,
    pub det_mean: [f32; 3],
    pub det_std: [f32; 3],
    pub det_scale: f32,
    /// `img_mode: RGB` (the bundles say BGR, cv2's own order).
    pub det_rgb: bool,
    pub det_max_side: usize,
    pub det_size_multiple: usize,
    pub det_thresh: f32,
    pub det_box_thresh: f64,
    pub det_unclip_ratio: f64,
    pub det_max_candidates: usize,
    /// `[C, H, W]`.
    pub rec_input_shape: [usize; 3],
    pub use_space_char: bool,
    pub charset: Vec<String>,
}

#[derive(Deserialize)]
struct Raw {
    det: RawDet,
    rec: RawRec,
    #[serde(default)]
    use_space_char: bool,
}

#[derive(Deserialize)]
struct RawDet {
    preprocess: RawPre,
    postprocess: RawPost,
}

#[derive(Deserialize)]
struct RawPre {
    mean: Vec<f64>,
    std: Vec<f64>,
    scale: f64,
    #[serde(default)]
    img_mode: Option<String>,
    max_side: f64,
    size_multiple: f64,
}

#[derive(Deserialize)]
struct RawPost {
    thresh: f64,
    box_thresh: f64,
    unclip_ratio: f64,
    max_candidates: f64,
}

#[derive(Deserialize)]
struct RawRec {
    input_shape: Vec<f64>,
}

fn triple(v: &[f64], what: &str) -> anyhow::Result<[f32; 3]> {
    match v {
        [a, b, c] => Ok([*a as f32, *b as f32, *c as f32]),
        _ => bail!("det.preprocess.{what} must have 3 values"),
    }
}

impl OcrConfig {
    pub fn det_model(&self) -> PathBuf {
        self.dir.join("det.onnx")
    }

    pub fn rec_model(&self) -> PathBuf {
        self.dir.join("rec.onnx")
    }

    pub fn load(dir: &Path) -> anyhow::Result<OcrConfig> {
        let cfg_path = dir.join("config.json");
        let text = std::fs::read_to_string(&cfg_path)
            .with_context(|| format!("reading {}", cfg_path.display()))?;
        let raw: Raw = serde_json::from_str(&text)
            .with_context(|| format!("parsing {}", cfg_path.display()))?;
        let shape: Vec<usize> = raw.rec.input_shape.iter().map(|v| *v as usize).collect();
        let [c, h, w] = shape[..] else {
            bail!(
                "rec.input_shape must be [C, H, W]; got {:?}",
                raw.rec.input_shape
            );
        };
        let charset_path = dir.join("charset.txt");
        let charset = load_charset(
            &std::fs::read_to_string(&charset_path)
                .with_context(|| format!("reading {}", charset_path.display()))?,
        );
        if charset.is_empty() {
            bail!("empty charset at {}", charset_path.display());
        }
        let pre = &raw.det.preprocess;
        let post = &raw.det.postprocess;
        Ok(OcrConfig {
            dir: dir.to_path_buf(),
            det_mean: triple(&pre.mean, "mean")?,
            det_std: triple(&pre.std, "std")?,
            det_scale: pre.scale as f32,
            det_rgb: pre
                .img_mode
                .as_deref()
                .is_some_and(|m| m.eq_ignore_ascii_case("RGB")),
            det_max_side: pre.max_side as usize,
            det_size_multiple: pre.size_multiple as usize,
            // numpy 2 compares the f32 map against the threshold as f32.
            det_thresh: post.thresh as f32,
            det_box_thresh: post.box_thresh,
            det_unclip_ratio: post.unclip_ratio,
            det_max_candidates: post.max_candidates as usize,
            rec_input_shape: [c, h, w],
            use_space_char: raw.use_space_char,
            charset,
        })
    }

    /// `build_decode_charset`: index 0 is the CTC blank; a head two wider
    /// than the charset carries a trailing space class. Any other width
    /// would shift every character, so it refuses.
    pub fn decode_charset(&self, rec_output_dim: usize) -> anyhow::Result<Vec<String>> {
        let n = self.charset.len();
        let extra = rec_output_dim as i64 - n as i64;
        if extra != 1 && extra != 2 {
            bail!(
                "recognition model output width ({rec_output_dim}) does not match charset size \
                 ({n}); expected {} or {}. This indicates a tier/charset mismatch which would \
                 shift every decoded character by one - refusing to start.",
                n + 1,
                n + 2
            );
        }
        if extra != if self.use_space_char { 2 } else { 1 } {
            tracing::debug!(
                use_space_char = self.use_space_char,
                rec_output_dim,
                "ocr: rec output width disagrees with use_space_char; trusting the model"
            );
        }
        let mut out = Vec::with_capacity(n + 2);
        out.push("<blank>".to_string());
        out.extend(self.charset.iter().cloned());
        if extra == 2 {
            out.push(" ".to_string());
        }
        Ok(out)
    }
}

/// `readlines()` in text mode with only the line ending stripped (an entry
/// may be a single space); a blank last line is dropped.
pub fn load_charset(text: &str) -> Vec<String> {
    let text = text.replace("\r\n", "\n").replace('\r', "\n");
    let mut out: Vec<String> = text
        .split_inclusive('\n')
        .map(|l| l.strip_suffix('\n').unwrap_or(l).to_string())
        .collect();
    if out.last().is_some_and(|l| l.is_empty()) {
        out.pop();
    }
    out
}
