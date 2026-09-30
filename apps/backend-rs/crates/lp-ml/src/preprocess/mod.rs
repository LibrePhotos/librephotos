//! Shared preprocessing: decoding like Pillow / cv2, Pillow-exact and
//! cv2-style resizes, and NCHW float tensors.

pub mod cv2;
pub mod pil;

use std::path::Path;
use std::sync::OnceLock;

use anyhow::Context;
use image::{DynamicImage, RgbImage};

pub use pil::Filter;

/// A decoder that takes over files it returns `Some` for (e.g. libvips'
/// libjpeg-turbo, which decodes JPEG like Pillow and cv2 do).
pub type Decoder = Box<dyn Fn(&Path) -> Option<anyhow::Result<RgbImage>> + Send + Sync>;

static DECODER: OnceLock<Decoder> = OnceLock::new();

/// Install the process-wide [`Decoder`]; the first call wins.
pub fn set_decoder(d: Decoder) -> bool {
    DECODER.set(d).is_ok()
}

/// `Image.open(path).convert("RGB")`: EXIF orientation is NOT applied (Pillow
/// does not either); alpha is dropped, grey is replicated. PNG and WebP
/// decode bit-identically to Pillow; JPEG (zune-jpeg vs libjpeg-turbo)
/// differs by up to ~8 levels unless a [`Decoder`] is installed.
pub fn load_rgb(path: &Path) -> anyhow::Result<RgbImage> {
    if let Some(d) = DECODER.get()
        && let Some(r) = d(path)
    {
        return r;
    }
    Ok(open(path)?.to_rgb8())
}

/// Decode any supported still image (JPEG, PNG, WebP, GIF, TIFF, BMP).
pub fn open(path: &Path) -> anyhow::Result<DynamicImage> {
    image::ImageReader::open(path)
        .with_context(|| format!("opening {}", path.display()))?
        .with_guessed_format()
        .with_context(|| format!("reading {}", path.display()))?
        .decode()
        .with_context(|| format!("decoding {}", path.display()))
}

/// Channel order of a tensor.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Order {
    Rgb,
    /// cv2 images (PP-OCR, insightface).
    Bgr,
}

/// `((pixel * scale) - mean) / std` per channel, laid out CHW, all in f32
/// in numpy's order of operations (`arr / 255.0` then `(arr - MEAN) / STD`
/// with `scale = 1/255` gives the same bits as `np.float32` code).
/// `mean`/`std` are in the output channel order.
pub fn to_chw(
    pixels: &[u8],
    w: usize,
    h: usize,
    order: Order,
    scale: Scale,
    mean: [f32; 3],
    std: [f32; 3],
) -> Vec<f32> {
    assert_eq!(pixels.len(), w * h * 3, "RGB buffer size");
    let plane = w * h;
    let mut out = vec![0f32; 3 * plane];
    for i in 0..plane {
        for c in 0..3 {
            let src_c = match order {
                Order::Rgb => c,
                Order::Bgr => 2 - c,
            };
            let v = scale.apply(pixels[i * 3 + src_c]);
            out[c * plane + i] = (v - mean[c]) / std[c];
        }
    }
    out
}

/// How a u8 becomes a float before the mean/std step.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Scale {
    /// `x / 255.0` (numpy true division in f32).
    Div255,
    /// `x * s` (e.g. PP-OCR's `scale: 1/255` multiplied in).
    Mul(f32),
    /// The raw value.
    None,
}

impl Scale {
    #[inline]
    fn apply(self, x: u8) -> f32 {
        match self {
            Scale::Div255 => x as f32 / 255.0,
            Scale::Mul(s) => x as f32 * s,
            Scale::None => x as f32,
        }
    }
}

/// CLIP / OpenAI normalisation constants (the Python literals, verbatim).
#[allow(clippy::excessive_precision)]
pub const CLIP_MEAN: [f32; 3] = [0.481_454_66, 0.457_827_5, 0.408_210_73];
#[allow(clippy::excessive_precision)]
pub const CLIP_STD: [f32; 3] = [0.268_629_54, 0.261_302_58, 0.275_777_11];

/// `np.stack` of equally sized CHW tensors: `([n, c, h, w], data)`.
pub fn stack(items: &[Vec<f32>], c: usize, h: usize, w: usize) -> ([usize; 4], Vec<f32>) {
    let mut data = Vec::with_capacity(items.len() * c * h * w);
    for t in items {
        assert_eq!(t.len(), c * h * w, "tensor size");
        data.extend_from_slice(t);
    }
    ([items.len(), c, h, w], data)
}

/// L2 norm in f64 over f32 values (`float(np.linalg.norm(e))`).
pub fn l2_norm(v: &[f32]) -> f64 {
    // numpy computes the f32 norm in f32 (pairwise sum of squares, then sqrt).
    let mut acc = 0f32;
    for x in v {
        acc += x * x;
    }
    acc.sqrt() as f64
}
