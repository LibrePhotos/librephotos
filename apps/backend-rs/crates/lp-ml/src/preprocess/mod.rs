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
/// differs by up to ~8 levels unless a [`Decoder`] is installed. Damaged
/// files fail as in Pillow ([`open_pillow`]); 16-bit images convert as
/// Pillow does ([`pillow_rgb8`]).
pub fn load_rgb(path: &Path) -> anyhow::Result<RgbImage> {
    if let Some(d) = DECODER.get()
        && let Some(r) = d(path)
    {
        return r;
    }
    Ok(pillow_rgb8(open_pillow(path)?))
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

/// [`open`] with Pillow's verdict on damaged files: a JPEG cut short is an
/// error ("image file is truncated"; zune-jpeg would fill the missing rows
/// with grey), a PNG cut inside its `IEND` chunk still opens.
pub fn open_pillow(path: &Path) -> anyhow::Result<DynamicImage> {
    let mut bytes = std::fs::read(path).with_context(|| format!("opening {}", path.display()))?;
    if jpeg_truncated(&bytes) {
        anyhow::bail!("decoding {}: image file is truncated", path.display());
    }
    if let Some(fixed) = png_close_tail(&bytes) {
        bytes = fixed;
    }
    image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .with_context(|| format!("reading {}", path.display()))?
        .decode()
        .with_context(|| format!("decoding {}", path.display()))
}

/// `convert("RGB")` of what Pillow opens: 16-bit colour (and grey+alpha)
/// images come in with the high byte of each sample; 16-bit grey is mode
/// `I;16`, whose conversion clips at 255 rather than scaling.
pub fn pillow_rgb8(img: DynamicImage) -> RgbImage {
    let (w, h) = (img.width(), img.height());
    let raw: Vec<u8> = match &img {
        DynamicImage::ImageLuma16(g) => g
            .as_raw()
            .iter()
            .flat_map(|&v| [v.min(255) as u8; 3])
            .collect(),
        DynamicImage::ImageLumaA16(g) => g
            .as_raw()
            .chunks_exact(2)
            .flat_map(|p| [(p[0] >> 8) as u8; 3])
            .collect(),
        DynamicImage::ImageRgb16(i) => i.as_raw().iter().map(|&v| (v >> 8) as u8).collect(),
        DynamicImage::ImageRgba16(i) => i
            .as_raw()
            .chunks_exact(4)
            .flat_map(|p| [(p[0] >> 8) as u8, (p[1] >> 8) as u8, (p[2] >> 8) as u8])
            .collect(),
        _ => return img.to_rgb8(),
    };
    RgbImage::from_raw(w, h, raw).expect("RGB buffer size")
}

/// A PNG cut inside or before its `IEND` chunk, closed with a fresh `IEND`
/// after the last whole chunk: Pillow stops reading once the image data is
/// complete, the png crate wants every chunk whole. `None` for anything
/// else (an image whose data is cut still fails to decode, as in Pillow).
pub fn png_close_tail(b: &[u8]) -> Option<Vec<u8>> {
    const SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";
    const IEND: [u8; 12] = [0, 0, 0, 0, b'I', b'E', b'N', b'D', 0xAE, 0x42, 0x60, 0x82];
    if !b.starts_with(SIGNATURE) {
        return None;
    }
    let mut i = SIGNATURE.len();
    while i + 12 <= b.len() {
        if &b[i + 4..i + 8] == b"IEND" {
            return None;
        }
        let len = u32::from_be_bytes([b[i], b[i + 1], b[i + 2], b[i + 3]]) as usize;
        match i.checked_add(12).and_then(|e| e.checked_add(len)) {
            Some(end) if end <= b.len() => i = end,
            _ => break,
        }
    }
    let mut out = Vec::with_capacity(i + IEND.len());
    out.extend_from_slice(&b[..i]);
    out.extend_from_slice(&IEND);
    Some(out)
}

/// A JPEG whose entropy-coded data has no EOI after the first scan header,
/// i.e. a file cut off mid-image. Non-JPEG input is `false`.
pub fn jpeg_truncated(b: &[u8]) -> bool {
    if !b.starts_with(&[0xFF, 0xD8]) {
        return false;
    }
    let mut i = 2;
    loop {
        while i + 1 < b.len() && b[i] == 0xFF && b[i + 1] == 0xFF {
            i += 1;
        }
        if i + 4 > b.len() {
            return true;
        }
        if b[i] != 0xFF {
            // Not a marker: leave the verdict to the decoder.
            return false;
        }
        let marker = b[i + 1];
        if marker == 0xD9 {
            return false;
        }
        if (0xD0..=0xD7).contains(&marker) || marker == 0x01 {
            i += 2;
            continue;
        }
        let len = u16::from_be_bytes([b[i + 2], b[i + 3]]) as usize;
        if marker == 0xDA {
            return !b
                .get(i + 2 + len..)
                .is_some_and(|rest| rest.windows(2).any(|w| w == [0xFF, 0xD9]));
        }
        i += 2 + len;
    }
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
