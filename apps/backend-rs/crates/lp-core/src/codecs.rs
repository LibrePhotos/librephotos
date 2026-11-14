//! Django storage formats (02 §3). Everything Rust writes must stay readable
//! by Django, so these are byte-for-byte ports.

use std::fmt;

use serde::{Deserialize, Serialize};

/// `File.hash` / `Photo.image_hash`: `md5hex + str(user_id)`. Also names the
/// thumbnail files. Not unique across users (see media `_pick_visible_photo`).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, sqlx::Type)]
#[serde(transparent)]
#[sqlx(transparent)]
pub struct FileHash(pub String);

impl FileHash {
    pub fn new(md5_hex: &str, user_id: i32) -> Self {
        FileHash(format!("{md5_hex}{user_id}"))
    }

    /// From raw file bytes' MD5 digest.
    pub fn from_digest(digest: &[u8; 16], user_id: i32) -> Self {
        Self::new(&hex::encode(digest), user_id)
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// The 32-char MD5 part (the rest is the user id).
    pub fn md5_part(&self) -> &str {
        self.0.get(..32).unwrap_or(&self.0)
    }
}

impl fmt::Display for FileHash {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum CodecError {
    #[error("invalid hex: {0}")]
    Hex(#[from] hex::FromHexError),
    #[error("length {0} is not a multiple of 8")]
    Length(usize),
    #[error("invalid value: {0}")]
    Invalid(String),
}

/// `Face.encoding` / `Cluster.mean_face_encoding`: `ndarray.tobytes().hex()`
/// of a float64 little-endian vector (512-d in practice).
pub struct FaceEncoding;

impl FaceEncoding {
    pub fn encode(values: &[f64]) -> String {
        let mut bytes = Vec::with_capacity(values.len() * 8);
        for v in values {
            bytes.extend_from_slice(&v.to_le_bytes());
        }
        hex::encode(bytes)
    }

    pub fn decode(text: &str) -> Result<Vec<f64>, CodecError> {
        let bytes = hex::decode(text.trim())?;
        if bytes.len() % 8 != 0 {
            return Err(CodecError::Length(bytes.len()));
        }
        Ok(bytes
            .chunks_exact(8)
            .map(|c| f64::from_le_bytes(c.try_into().expect("chunk of 8")))
            .collect())
    }
}

/// `Photo.clip_embeddings`: jsonb list of floats (unnormalized) with
/// `clip_embeddings_magnitude`. Legacy rows hold the list double-encoded as a
/// JSON string.
pub struct ClipEmbedding;

impl ClipEmbedding {
    pub fn decode(value: &serde_json::Value) -> Option<Vec<f32>> {
        match value {
            serde_json::Value::Array(items) => {
                items.iter().map(|v| v.as_f64().map(|f| f as f32)).collect()
            }
            serde_json::Value::String(s) => {
                let inner: serde_json::Value = serde_json::from_str(s).ok()?;
                match inner {
                    serde_json::Value::Array(_) => Self::decode(&inner),
                    _ => None,
                }
            }
            _ => None,
        }
    }

    pub fn encode(values: &[f32]) -> serde_json::Value {
        serde_json::Value::Array(
            values
                .iter()
                .map(|v| serde_json::Value::from(*v as f64))
                .collect(),
        )
    }

    pub fn magnitude(values: &[f32]) -> f64 {
        values
            .iter()
            .map(|v| (*v as f64) * (*v as f64))
            .sum::<f64>()
            .sqrt()
    }
}

/// `Thumbnail.dominant_color`: Python list repr `"[r, g, b]"`.
pub struct DominantColor;

impl DominantColor {
    pub fn format(rgb: [u8; 3]) -> String {
        format!("[{}, {}, {}]", rgb[0], rgb[1], rgb[2])
    }

    /// Mirrors `PhotoSummarySerializer.get_dominantColor`: strip the brackets,
    /// split on `", "`, parse ints.
    pub fn parse(text: &str) -> Option<[u8; 3]> {
        let inner = text.strip_prefix('[')?.strip_suffix(']')?;
        let mut parts = inner.split(", ");
        let mut out = [0u8; 3];
        for slot in &mut out {
            let n: i64 = parts.next()?.trim().parse().ok()?;
            *slot = u8::try_from(n).ok()?;
        }
        if parts.next().is_some() {
            return None;
        }
        Some(out)
    }

    /// `"#rrggbb"` for the PigPhoto `dominantColor`; `""` when absent or unparsable.
    pub fn css_hex(text: Option<&str>) -> String {
        match text.filter(|s| !s.is_empty()).and_then(Self::parse) {
            Some([r, g, b]) => format!("#{r:02x}{g:02x}{b:02x}"),
            None => String::new(),
        }
    }
}

/// Python's `round(x, ndigits)`: correctly rounded from the exact binary
/// value, ties to even. `(x * 100).round() / 100` is NOT equivalent.
pub fn py_round(x: f64, ndigits: u32) -> f64 {
    if !x.is_finite() {
        return x;
    }
    // Rust's `{:.N}` formatting is exact (rounds the true binary value, ties
    // to even), which is exactly what CPython's round() does via dtoa.
    let s = format!("{:.*}", ndigits as usize, x);
    s.parse::<f64>().unwrap_or(x)
}

/// Aspect ratio as the scanner stores it: `round(w / h, 2)`.
pub fn aspect_ratio(width: u32, height: u32) -> Option<f64> {
    if height == 0 {
        return None;
    }
    Some(py_round(width as f64 / height as f64, 2))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_hash() {
        let h = FileHash::new("d41d8cd98f00b204e9800998ecf8427e", 12);
        assert_eq!(h.as_str(), "d41d8cd98f00b204e9800998ecf8427e12");
        assert_eq!(h.md5_part(), "d41d8cd98f00b204e9800998ecf8427e");
    }

    #[test]
    fn face_encoding_roundtrip() {
        // numpy.array([1.0, -0.5]).tobytes().hex()
        let hex = "000000000000f03f000000000000e0bf";
        assert_eq!(FaceEncoding::decode(hex).unwrap(), vec![1.0, -0.5]);
        assert_eq!(FaceEncoding::encode(&[1.0, -0.5]), hex);
        assert!(FaceEncoding::decode("00ff").is_err());
    }

    #[test]
    fn clip_legacy_string() {
        let v = serde_json::json!("[0.5, 1.5]");
        assert_eq!(ClipEmbedding::decode(&v).unwrap(), vec![0.5, 1.5]);
        let v = serde_json::json!([3.0, 4.0]);
        assert_eq!(
            ClipEmbedding::magnitude(&ClipEmbedding::decode(&v).unwrap()),
            5.0
        );
    }

    #[test]
    fn dominant_color() {
        assert_eq!(DominantColor::format([1, 22, 255]), "[1, 22, 255]");
        assert_eq!(DominantColor::parse("[1, 22, 255]"), Some([1, 22, 255]));
        assert_eq!(DominantColor::css_hex(Some("[1, 22, 255]")), "#0116ff");
        assert_eq!(DominantColor::css_hex(Some("")), "");
        assert_eq!(DominantColor::css_hex(None), "");
    }

    #[test]
    fn python_round() {
        // Values checked against CPython 3.11.
        assert_eq!(py_round(2.675, 2), 2.67);
        assert_eq!(py_round(0.125, 2), 0.12);
        assert_eq!(py_round(0.375, 2), 0.38);
        assert_eq!(py_round(1.005, 2), 1.0);
        assert_eq!(py_round(1.3333333, 2), 1.33);
        assert_eq!(py_round(0.5, 0), 0.0);
        assert_eq!(py_round(1.5, 0), 2.0);
        assert_eq!(py_round(2.5, 0), 2.0);
        assert_eq!(aspect_ratio(4000, 3000), Some(1.33));
        assert_eq!(aspect_ratio(3, 2), Some(1.5));
        assert_eq!(aspect_ratio(1, 0), None);
    }
}
