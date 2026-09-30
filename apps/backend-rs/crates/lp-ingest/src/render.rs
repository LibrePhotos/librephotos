//! Thumbnails (`api/thumbnails.py`, `Thumbnail._generate_thumbnail`):
//! big WebP <= 1080 px high, 500 / 250 resized from it in memory, WebP Q95
//! effort 2, `local_orientation` applied on top of the EXIF autorotation;
//! videos through ffmpeg with Django's exact arguments.
//!
//! Decoders, in order: libvips (`LP_VIPS_LIB`); for files it rejects (HEIC,
//! JPEG XL, ... which the bundled libvips lacks) Pillow through the Python
//! interpreter, as `image_decoding._pillow_to_vips` does; RAW files their
//! embedded preview, else `lp_ml::raw_thumbnail` (in-process or the sidecar).
//! Without libvips at all, a pure-Rust path (`image` +
//! `fast_image_resize` + libwebp) does the same work.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::OnceLock;
use std::time::Duration;

use anyhow::{Context, anyhow, bail};

use crate::fsutil::{self, media_name};
use crate::vips::{self, Vips};

pub const BIG: &str = "thumbnails_big";
pub const SQUARE: &str = "square_thumbnails";
pub const SQUARE_SMALL: &str = "square_thumbnails_small";
pub const STATIC_DIRS: [&str; 3] = [BIG, SQUARE, SQUARE_SMALL];

pub fn height_of(dir: &str) -> i32 {
    match dir {
        BIG => 1080,
        SQUARE => 500,
        _ => 250,
    }
}

const WEBP_Q: i32 = 95;
const WEBP_EFFORT: i32 = 2;
const FFMPEG_TIMEOUT: Duration = Duration::from_secs(300);

/// Everything rendering needs; cheap to clone into blocking tasks.
#[derive(Clone)]
pub struct Renderer {
    pub media_root: PathBuf,
    pub vips_lib: Option<PathBuf>,
    pub python: PathBuf,
    pub ffmpeg: PathBuf,
    pub ffprobe: PathBuf,
    /// RAW rendering (`raw_thumbnail`: in-process or the thumbnail sidecar).
    pub ml: lp_ml::MlHandle,
    pub http: reqwest::Client,
}

impl Renderer {
    pub fn from_state(state: &lp_core::AppState) -> Self {
        let b = &state.config.binaries;
        Renderer {
            media_root: state.config.media_root.clone(),
            vips_lib: b.vips_lib.clone(),
            python: b.python.clone(),
            ffmpeg: b.ffmpeg.clone(),
            ffprobe: b.ffprobe.clone(),
            ml: state.ml_handle(),
            http: state.http.clone(),
        }
    }

    pub fn vips(&self) -> Option<&'static Vips> {
        vips::get(self.vips_lib.as_deref())
    }

    pub fn path(&self, dir: &str, hash: &str, ext: &str) -> PathBuf {
        self.media_root.join(dir).join(format!("{hash}{ext}"))
    }

    /// The relative name stored in `api_thumbnail` (`os.path.join(dir, hash + ext)`).
    pub fn stored_name(dir: &str, hash: &str, ext: &str) -> String {
        media_name(dir, &format!("{hash}{ext}"))
    }

    pub fn ensure_dirs(&self) -> std::io::Result<()> {
        for d in STATIC_DIRS {
            std::fs::create_dir_all(self.media_root.join(d))?;
        }
        Ok(())
    }

    /// `image_decoding.can_decode`: a libvips header load, else a decoder
    /// that recognises the bytes (Pillow's role).
    pub fn can_decode(&self, path: &Path) -> bool {
        if let Some(v) = self.vips() {
            if v.can_load(path) {
                return true;
            }
            return fsutil::sniffed_mime(path).is_some_and(|m| m.starts_with("image/"));
        }
        image::ImageReader::open(path)
            .and_then(|r| r.with_guessed_format())
            .map(|r| r.format().is_some())
            .unwrap_or(false)
            || fsutil::sniffed_mime(path).is_some_and(|m| m.starts_with("image/"))
    }

    /// `create_static_thumbnails` for the missing `dirs` (blocking).
    pub fn static_thumbnails(
        &self,
        input: &Path,
        hash: &str,
        dirs: &[&str],
        local_orientation: i32,
    ) -> anyhow::Result<()> {
        let big_path = self.path(BIG, hash, ".webp");
        let Some(v) = self.vips() else {
            return self.static_thumbnails_rust(input, hash, dirs, local_orientation);
        };
        let mut big = None;
        if dirs.contains(&BIG) {
            big = self.render_big(v, input, &big_path, local_orientation)?;
        }
        let smaller: Vec<&str> = dirs.iter().copied().filter(|d| *d != BIG).collect();
        if smaller.is_empty() {
            return Ok(());
        }
        let big = match big {
            Some(b) => b,
            None => {
                let data = std::fs::read(&big_path)
                    .with_context(|| format!("reading {}", big_path.display()))?;
                // libvips reads `data` lazily: decode before it is dropped.
                v.load_buffer(&data)
                    .and_then(|i| i.copy_memory())
                    .map_err(|e| anyhow!(e))?
            }
        };
        let big = big.copy_memory().map_err(|e| anyhow!(e))?;
        for dir in smaller {
            let small = big
                .thumbnail_image(height_of(dir))
                .map_err(|e| anyhow!(e))?;
            small
                .webpsave(&self.path(dir, hash, ".webp"), WEBP_Q, Some(WEBP_EFFORT))
                .map_err(|e| anyhow!(e))?;
        }
        Ok(())
    }

    /// `_render_big_thumbnail`: returns the image when rendered in-process.
    fn render_big(
        &self,
        v: &'static Vips,
        input: &Path,
        out: &Path,
        local_orientation: i32,
    ) -> anyhow::Result<Option<vips::Image>> {
        let height = height_of(BIG);
        if fsutil::is_raw(&fsutil::path_str(input)) {
            // Never libvips (Django neither): it would read a TIFF-based RAW's
            // small IFD0 thumbnail or its CFA plane as the picture.
            self.raw_big(input, out, local_orientation, false)?;
            return Ok(None);
        }
        let img = self.decode(v, input, height)?;
        let img = orient(img, local_orientation)?;
        img.webpsave(out, WEBP_Q, Some(WEBP_EFFORT))
            .map_err(|e| anyhow!(e))?;
        Ok(Some(img))
    }

    /// `image_decoding.thumbnail`: libvips, else Pillow's decode.
    fn decode(&self, v: &'static Vips, input: &Path, height: i32) -> anyhow::Result<vips::Image> {
        match v.thumbnail_file(input, height) {
            Ok(img) => Ok(img),
            Err(vips_err) => {
                let png = self
                    .pillow_decode(input)
                    .with_context(|| format!("libvips: {vips_err}"))?;
                let img = v.thumbnail_file(&png, height).map_err(|e| anyhow!(e))?;
                Ok(img)
            }
        }
    }

    /// Pillow + pillow-heif/jxl decode, EXIF-transposed, RGB, into a temp PNG.
    fn pillow_decode(&self, input: &Path) -> anyhow::Result<tempfile::TempPath> {
        const SCRIPT: &str = "import sys\n\
from PIL import Image, ImageOps\n\
try:\n    import pillow_heif; pillow_heif.register_heif_opener()\nexcept Exception:\n    pass\n\
try:\n    import pillow_jxl\nexcept Exception:\n    pass\n\
Image.MAX_IMAGE_PIXELS = 250_000_000\n\
with Image.open(sys.argv[1]) as image:\n    ImageOps.exif_transpose(image).convert('RGB').save(sys.argv[2], 'PNG', compress_level=1)\n";
        let tmp = tempfile::Builder::new()
            .prefix("lp-decode-")
            .suffix(".png")
            .tempfile()?
            .into_temp_path();
        let out = std::process::Command::new(&self.python)
            .arg("-c")
            .arg(SCRIPT)
            .arg(input)
            .arg(&*tmp)
            .stdin(Stdio::null())
            .output()
            .with_context(|| format!("starting {}", self.python.display()))?;
        if !out.status.success() {
            bail!(
                "no decoder for {}: {}",
                input.display(),
                tail(&String::from_utf8_lossy(&out.stderr))
            );
        }
        Ok(tmp)
    }

    /// `_request_raw_thumbnail`: the RAW renderer (thumbnail sidecar or in-process).
    fn raw_sidecar(
        &self,
        input: &Path,
        height: i32,
        out: &Path,
        local_orientation: i32,
    ) -> anyhow::Result<()> {
        let (source, destination) = (fsutil::path_str(input), fsutil::path_str(out));
        let ml = self.ml.clone();
        let handle = tokio::runtime::Handle::try_current()
            .map_err(|_| anyhow!("no runtime for the RAW renderer"))?;
        handle
            .block_on(async move {
                ml.view()
                    .raw_thumbnail()
                    .render_thumbnail(&source, &destination, height.max(0) as u32)
                    .await
            })
            .map_err(|e| anyhow!("RAW render of {} failed: {}", input.display(), e.detail()))?;
        if local_orientation > 1 {
            if let Some(v) = self.vips() {
                let data = std::fs::read(out)?;
                let img = v.load_buffer(&data).map_err(|e| anyhow!(e))?;
                let img = img.copy_memory().map_err(|e| anyhow!(e))?;
                let img = orient(img, local_orientation)?;
                img.webpsave(out, WEBP_Q, Some(WEBP_EFFORT))
                    .map_err(|e| anyhow!(e))?;
            } else {
                let img = rust_orient(image::open(out)?, local_orientation);
                rust_webp(&img, out)?;
            }
        }
        Ok(())
    }

    /// `_render_raw_thumbnail` (big): the camera's embedded preview when it
    /// is usable (`image_decoding.raw_preview`, always in-process), else the
    /// RAW renderer. `legacy` skips the preview, as releases before it did.
    fn raw_big(
        &self,
        input: &Path,
        out: &Path,
        local_orientation: i32,
        legacy: bool,
    ) -> anyhow::Result<()> {
        let height = height_of(BIG);
        if !legacy && let Some(img) = lp_ml::raw_thumbnail::raw_preview(input, height as u32) {
            let img = rust_orient(image::DynamicImage::ImageRgb8(img), local_orientation);
            return rust_webp(&img, out);
        }
        self.raw_sidecar(input, height, out, local_orientation)
    }

    /// `render_big_thumbnail_to`: the big thumbnail written to `out` (for
    /// comparing a changed file with the index). `legacy` = libwebp's default
    /// effort, as releases before effort 2 rendered it.
    pub fn render_big_to(
        &self,
        input: &Path,
        out: &Path,
        local_orientation: i32,
        legacy: bool,
    ) -> anyhow::Result<()> {
        if fsutil::is_raw(&fsutil::path_str(input)) {
            return self.raw_big(input, out, local_orientation, legacy);
        }
        let Some(v) = self.vips() else {
            let img = rust_decode(input, height_of(BIG))?;
            let img = rust_orient(img, local_orientation);
            return rust_webp(&img, out);
        };
        let img = orient(self.decode(v, input, height_of(BIG))?, local_orientation)?;
        img.webpsave(out, WEBP_Q, if legacy { None } else { Some(WEBP_EFFORT) })
            .map_err(|e| anyhow!(e))
    }

    fn static_thumbnails_rust(
        &self,
        input: &Path,
        hash: &str,
        dirs: &[&str],
        local_orientation: i32,
    ) -> anyhow::Result<()> {
        let big_path = self.path(BIG, hash, ".webp");
        let big = if dirs.contains(&BIG) && fsutil::is_raw(&fsutil::path_str(input)) {
            self.raw_big(input, &big_path, local_orientation, false)?;
            image::open(&big_path)?
        } else if dirs.contains(&BIG) {
            let img = rust_orient(rust_decode(input, height_of(BIG))?, local_orientation);
            rust_webp(&img, &big_path)?;
            img
        } else {
            image::open(&big_path)?
        };
        for dir in dirs.iter().filter(|d| **d != BIG) {
            let small = rust_resize(&big, height_of(dir))?;
            rust_webp(&small, &self.path(dir, hash, ".webp"))?;
        }
        Ok(())
    }

    // ---- video -------------------------------------------------------------

    /// `create_thumbnail_for_video`: the first frame as the big WebP.
    pub async fn video_big(&self, input: &Path, hash: &str) -> anyhow::Result<()> {
        let output = self.path(BIG, hash, ".webp");
        let mut cmd: Vec<String> = vec![
            "-y".into(),
            "-i".into(),
            fsutil::path_str(input),
            "-ss".into(),
            "00:00:00.000".into(),
            "-vframes".into(),
            "1".into(),
        ];
        if let Some(f) = self.video_filter(input, None).await {
            cmd.push("-filter:v".into());
            cmd.push(f);
        }
        cmd.push(fsutil::path_str(&output));
        self.run_ffmpeg(&cmd, &output).await
    }

    /// `create_animated_thumbnail`: 5 s of H.264, `scale=-2:<height>`.
    pub async fn video_animated(&self, input: &Path, hash: &str, dir: &str) -> anyhow::Result<()> {
        let output = self.path(dir, hash, ".mp4");
        let filter = self
            .video_filter(input, Some(format!("scale=-2:{}", height_of(dir))))
            .await
            .unwrap_or_default();
        let cmd: Vec<String> = vec![
            "-y".into(),
            "-i".into(),
            fsutil::path_str(input),
            "-to".into(),
            "00:00:05".into(),
            "-vcodec".into(),
            "libx264".into(),
            "-crf".into(),
            "20".into(),
            "-an".into(),
            "-filter:v".into(),
            filter,
            fsutil::path_str(&output),
        ];
        self.run_ffmpeg(&cmd, &output).await
    }

    async fn run_ffmpeg(&self, args: &[String], output: &Path) -> anyhow::Result<()> {
        let child = tokio::process::Command::new(&self.ffmpeg)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .with_context(|| format!("starting {}", self.ffmpeg.display()))?;
        match tokio::time::timeout(FFMPEG_TIMEOUT, child.wait_with_output()).await {
            Ok(Ok(out)) if out.status.success() => Ok(()),
            Ok(Ok(out)) => {
                let _ = std::fs::remove_file(output);
                bail!(
                    "ffmpeg exited with status {}: {}",
                    out.status.code().unwrap_or(-1),
                    tail(&String::from_utf8_lossy(&out.stderr))
                )
            }
            Ok(Err(e)) => {
                let _ = std::fs::remove_file(output);
                Err(e.into())
            }
            Err(_) => {
                let _ = std::fs::remove_file(output);
                bail!(
                    "ffmpeg did not finish within {} s: no output",
                    FFMPEG_TIMEOUT.as_secs()
                )
            }
        }
    }

    /// `video_color.video_filter`: the caller's scale, then a tonemap for
    /// PQ/HLG sources (zscale when this ffmpeg has it, else 8-bit only).
    async fn video_filter(&self, input: &Path, scale: Option<String>) -> Option<String> {
        const TONEMAP: &str = "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable,zscale=t=bt709:m=bt709:r=tv,format=yuv420p";
        let mut steps: Vec<String> = scale.into_iter().collect();
        let transfer = self.transfer_characteristics(input).await;
        if transfer == "smpte2084" || transfer == "arib-std-b67" {
            if self.supports_zscale().await {
                steps.push(TONEMAP.into());
            } else {
                steps.push("format=yuv420p".into());
            }
        }
        if steps.is_empty() {
            None
        } else {
            Some(steps.join(","))
        }
    }

    async fn transfer_characteristics(&self, input: &Path) -> String {
        let run = tokio::process::Command::new(&self.ffprobe)
            .args([
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=color_transfer",
                "-of",
                "json",
            ])
            .arg(input)
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .output();
        let Ok(Ok(out)) = tokio::time::timeout(Duration::from_secs(30), run).await else {
            return String::new();
        };
        let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap_or_default();
        v["streams"][0]["color_transfer"]
            .as_str()
            .unwrap_or("")
            .to_string()
    }

    async fn supports_zscale(&self) -> bool {
        static ZSCALE: OnceLock<bool> = OnceLock::new();
        if let Some(v) = ZSCALE.get() {
            return *v;
        }
        let out = tokio::process::Command::new(&self.ffmpeg)
            .args(["-hide_banner", "-filters"])
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
            .await;
        let has = out
            .map(|o| {
                String::from_utf8_lossy(&o.stdout).lines().any(|l| {
                    let f: Vec<&str> = l.split_whitespace().collect();
                    f.len() > 1 && f[1] == "zscale"
                })
            })
            .unwrap_or(false);
        *ZSCALE.get_or_init(|| has)
    }
}

/// `_apply_local_orientation` (pyvips conventions).
pub fn orient(img: vips::Image, o: i32) -> anyhow::Result<vips::Image> {
    use vips::{
        ANGLE_D90, ANGLE_D180, ANGLE_D270, DIRECTION_HORIZONTAL as H, DIRECTION_VERTICAL as V,
    };
    let r = match o {
        2 => img.flip(H),
        3 => img.rot(ANGLE_D180),
        4 => img.flip(V),
        5 => img.rot(ANGLE_D90).and_then(|i| i.flip(H)),
        6 => img.rot(ANGLE_D270),
        7 => img.rot(ANGLE_D270).and_then(|i| i.flip(H)),
        8 => img.rot(ANGLE_D90),
        _ => return Ok(img),
    };
    r.map_err(|e| anyhow!(e))
}

fn tail(s: &str) -> String {
    let t = s.trim();
    if t.is_empty() {
        return "no output".into();
    }
    let start = t.len().saturating_sub(2000);
    let mut i = start;
    while !t.is_char_boundary(i) {
        i += 1;
    }
    t[i..].to_string()
}

// ---- pure-Rust fallback ----------------------------------------------------

fn exif_orientation(path: &Path) -> u32 {
    let Ok(file) = std::fs::File::open(path) else {
        return 1;
    };
    let mut reader = std::io::BufReader::new(file);
    let Ok(mut dec) = image::ImageReader::new(&mut reader).with_guessed_format() else {
        return 1;
    };
    dec.no_limits();
    match dec.into_decoder() {
        Ok(mut d) => {
            use image::ImageDecoder;
            match d.orientation() {
                Ok(o) => orientation_code(o),
                Err(_) => 1,
            }
        }
        Err(_) => 1,
    }
}

fn orientation_code(o: image::metadata::Orientation) -> u32 {
    use image::metadata::Orientation::*;
    match o {
        NoTransforms => 1,
        FlipHorizontal => 2,
        Rotate180 => 3,
        FlipVertical => 4,
        Rotate90FlipH => 5,
        Rotate90 => 6,
        Rotate270FlipH => 7,
        Rotate270 => 8,
    }
}

fn apply_code(img: image::DynamicImage, code: u32) -> image::DynamicImage {
    match code {
        2 => img.fliph(),
        3 => img.rotate180(),
        4 => img.flipv(),
        5 => img.rotate90().fliph(),
        6 => img.rotate90(),
        7 => img.rotate270().fliph(),
        8 => img.rotate270(),
        _ => img,
    }
}

fn rust_decode(path: &Path, height: i32) -> anyhow::Result<image::DynamicImage> {
    let img = image::open(path).with_context(|| format!("decoding {}", path.display()))?;
    let img = apply_code(img, exif_orientation(path));
    rust_resize(&img, height)
}

/// Local orientation in pyvips terms (6 = rot270, a quarter turn anticlockwise).
fn rust_orient(img: image::DynamicImage, o: i32) -> image::DynamicImage {
    match o {
        2 => img.fliph(),
        3 => img.rotate180(),
        4 => img.flipv(),
        5 => img.rotate90().fliph(),
        6 => img.rotate270(),
        7 => img.rotate270().fliph(),
        8 => img.rotate90(),
        _ => img,
    }
}

fn rust_resize(img: &image::DynamicImage, height: i32) -> anyhow::Result<image::DynamicImage> {
    use fast_image_resize as fr;
    let rgb = img.to_rgb8();
    let (w, h) = (rgb.width(), rgb.height());
    if h as i32 <= height {
        return Ok(image::DynamicImage::ImageRgb8(rgb));
    }
    let nh = height as u32;
    let nw = ((w as f64 * nh as f64 / h as f64).round() as u32).max(1);
    let src = fr::images::Image::from_vec_u8(w, h, rgb.into_raw(), fr::PixelType::U8x3)?;
    let mut dst = fr::images::Image::new(nw, nh, fr::PixelType::U8x3);
    let mut resizer = fr::Resizer::new();
    resizer.resize(
        &src,
        &mut dst,
        &fr::ResizeOptions::new().resize_alg(fr::ResizeAlg::Convolution(fr::FilterType::Lanczos3)),
    )?;
    let out = image::RgbImage::from_raw(nw, nh, dst.into_vec())
        .ok_or_else(|| anyhow!("resize buffer size"))?;
    Ok(image::DynamicImage::ImageRgb8(out))
}

fn rust_webp(img: &image::DynamicImage, out: &Path) -> anyhow::Result<()> {
    let rgb = img.to_rgb8();
    let enc = webp::Encoder::from_rgb(&rgb, rgb.width(), rgb.height());
    let mut cfg = webp::WebPConfig::new().map_err(|_| anyhow!("webp config"))?;
    cfg.quality = WEBP_Q as f32;
    cfg.method = WEBP_EFFORT;
    let mem = enc
        .encode_advanced(&cfg)
        .map_err(|e| anyhow!("webp encode: {e:?}"))?;
    std::fs::write(out, &*mem)?;
    Ok(())
}

/// Image size from the file header (Pillow's `Image.open(...).size`).
pub fn image_size(path: &Path) -> Option<(u32, u32)> {
    image::image_dimensions(path).ok()
}
