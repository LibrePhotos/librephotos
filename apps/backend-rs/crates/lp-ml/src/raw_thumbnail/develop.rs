//! Sensor data to 8-bit sRGB the way the thumbnail sidecar gets it from
//! rawpy: `postprocess(use_camera_wb=True, half_size=..., output_bps=8)`,
//! i.e. LibRaw's `dcraw_process` + `dcraw_make_mem_image` with rawpy's
//! defaults. rawler only decodes the sensor data and metadata; every step
//! after that is LibRaw's, in its order and number types:
//!
//! black subtraction -> `adjust_maximum` (0.75) -> `scale_colors` (camera
//! WB, highlight clip) -> half size (2x2 cells, greens averaged) or AHD
//! (bilinear for non-Bayer layouts) -> `convert_to_rgb` (the DNG/camera
//! matrix through `cam_xyz_coeff`) -> auto-brightness (1% clipped) and the
//! BT.709 gamma curve (rawpy's `gamma=(2.222, 4.5)`) -> LibRaw's flip.

// Index loops mirror LibRaw's C, which keeps the port checkable line by line.
#![allow(clippy::needless_range_loop)]

use std::path::Path;

use anyhow::{Context, anyhow, bail};
use image::RgbImage;
use rawler::RawImage;
use rawler::RawImageData;
use rawler::decoders::{Decoder, RawDecodeParams, WellKnownIFD};
use rawler::rawimage::RawPhotometricInterpretation;
use rawler::rawsource::RawSource;
use rawler::tags::TiffCommonTag;
use rayon::prelude::*;

/// XYZ (D65) -> linear sRGB inverse used by dcraw (`xyz_rgb`).
const XYZ_RGB: [[f64; 3]; 3] = [
    [0.412453, 0.357580, 0.180423],
    [0.212671, 0.715160, 0.072169],
    [0.019334, 0.119193, 0.950227],
];
/// rawpy `gamma=(2.222, 4.5)` becomes `gamm[0] = 1 / 2.222`.
const GAMMA_POWER: f64 = 1.0 / 2.222;
const GAMMA_SLOPE: f64 = 4.5;
/// LibRaw `auto_bright_thr` / `adjust_maximum_thr` defaults.
const AUTO_BRIGHT_THR: f32 = 0.01;
const ADJUST_MAXIMUM_THR: f32 = 0.75;

/// What the service renders: the whole sensor, LibRaw-oriented, 8 bits.
pub struct Developed {
    pub image: RgbImage,
    /// Rendered at half size (the sidecar's `half`).
    pub half: bool,
}

/// Largest sensor accepted, as Django caps decoded images
/// (`Image.MAX_IMAGE_PIXELS`): a crafted header must not make the process
/// allocate gigabytes (an allocation failure aborts, it does not unwind).
pub const MAX_PIXELS: usize = 250_000_000;

/// `rawpy.imread(path)`: rawler's decoder (panics become errors), refusing
/// sensors above [`MAX_PIXELS`] before the pixels are allocated.
pub fn decode(path: &Path) -> anyhow::Result<RawImage> {
    let p = path.to_path_buf();
    match std::panic::catch_unwind(move || open(&p, false)) {
        Ok(r) => r.map(|(raw, _, _)| raw),
        Err(_) => bail!("the RAW decoder crashed"),
    }
}

/// Decoder, source and raw image (`dummy`: sizes and metadata only). DNG
/// dimensions are checked from the raw IFD first, since even rawler's
/// dummy decode reserves the pixel buffer.
pub(super) fn open(
    path: &Path,
    dummy: bool,
) -> anyhow::Result<(RawImage, Box<dyn Decoder>, RawSource)> {
    let src = RawSource::new(path).map_err(|e| anyhow!("{e}"))?;
    let decoder = rawler::get_decoder(&src).map_err(|e| anyhow!("{e}"))?;
    if let Ok(Some(ifd)) = decoder.ifd(WellKnownIFD::Raw) {
        let dim = |t| ifd.get_entry(t).map_or(0, |e| e.force_usize(0));
        let (w, h) = (
            dim(TiffCommonTag::ImageWidth),
            dim(TiffCommonTag::ImageLength),
        );
        check_size(w, h)?;
    }
    let params = RawDecodeParams::default();
    if !dummy {
        let probe = decoder
            .raw_image(&src, &params, true)
            .map_err(|e| anyhow!("{e}"))?;
        check_size(probe.width, probe.height)?;
    }
    let raw = decoder
        .raw_image(&src, &params, dummy)
        .map_err(|e| anyhow!("{e}"))?;
    check_size(raw.width, raw.height)?;
    Ok((raw, decoder, src))
}

fn check_size(w: usize, h: usize) -> anyhow::Result<()> {
    match w.checked_mul(h) {
        Some(n) if n <= MAX_PIXELS => Ok(()),
        _ => bail!("RAW sensor of {w}x{h} pixels is above the {MAX_PIXELS} pixel limit"),
    }
}

/// LibRaw's visible area (`sizes.width/height` and the margins): the
/// ActiveArea, not the DNG DefaultCrop.
pub fn visible_area(raw: &RawImage) -> (usize, usize, usize, usize) {
    match raw.active_area {
        Some(r) if r.d.w > 0 && r.d.h > 0 => (r.p.x, r.p.y, r.d.w, r.d.h),
        _ => (0, 0, raw.width, raw.height),
    }
}

/// LibRaw's `flip` for an EXIF orientation (`"50132467"[o & 7]`).
pub fn libraw_flip(orientation: u16) -> u8 {
    b"50132467"[(orientation & 7) as usize] - b'0'
}

/// `render_raw` up to the pixels: decode `path`, half size when that still
/// covers `height`.
pub fn develop_file(path: &Path, height: u32) -> anyhow::Result<Developed> {
    let raw = decode(path).with_context(|| format!("decoding {}", path.display()))?;
    develop(raw, height)
}

/// Takes the image by value: its sample buffer is freed as soon as the
/// visible area is copied out, which keeps the peak at about two sensor-sized
/// buffers.
pub fn develop(raw: RawImage, height: u32) -> anyhow::Result<Developed> {
    let (left, top, w, h) = visible_area(&raw);
    if w == 0 || h == 0 || left + w > raw.width || top + h > raw.height {
        bail!("RAW has no image area");
    }
    let half = (h / 2) as u64 >= height as u64;
    let flip = libraw_flip(raw.orientation.to_u16());
    let mut src = Sensor::new(&raw, left, top, w, h)?;
    drop(raw);
    let scaled = src.scale_colors();
    let (planes, iw, ih) = match (&src.layout, half) {
        (Layout::Cfa { .. }, true) if src.cfa_2x2() => scaled.half_2x2(&src),
        (Layout::Cfa { .. }, true) => {
            let (full, fw, fh) = scaled.demosaic(&src);
            box_half(&full, fw, fh, src.colors)
        }
        (Layout::Cfa { .. }, false) if src.cfa_2x2() && src.colors == 3 => scaled.ahd(&src),
        (Layout::Cfa { .. }, false) => scaled.demosaic(&src),
        // LibRaw ignores half_size for data that is not a mosaic.
        (Layout::Planar, _) => (scaled.values, src.w, src.h),
    };
    let rgb = src.convert_to_rgb(&planes, iw * ih);
    let curve = gamma_curve(auto_white(&rgb.hist, iw * ih));
    Ok(Developed {
        image: output(&rgb.pixels, iw, ih, flip, &curve),
        half,
    })
}

enum Layout {
    /// One sample per pixel; `colors[i]` = LibRaw colour at pattern cell `i`.
    Cfa {
        pw: usize,
        ph: usize,
        colors: Vec<usize>,
    },
    /// `cpp` samples per pixel (LinearRaw) or one grey sample.
    Planar,
}

/// The visible sensor area with its levels: values relative to black.
struct Sensor {
    w: usize,
    h: usize,
    /// Channels after scaling (3 for RGB, 4 for CYGM/RGBE, 1 for grey).
    colors: usize,
    layout: Layout,
    /// Visible samples minus their black level (>= 0): `w*h` for a CFA,
    /// `w*h*colors` for planar data.
    values: Vec<u16>,
    maximum: f64,
    pre_mul: [f64; 4],
    /// `rgb_cam` (3 x colors), None = LibRaw's `raw_color` (no matrix).
    rgb_cam: Option<[[f32; 4]; 3]>,
}

struct Scaled {
    values: Vec<u16>,
}

struct Converted {
    pixels: Vec<[u16; 3]>,
    hist: Vec<[u32; 0x2000]>,
}

impl Sensor {
    fn new(raw: &RawImage, left: usize, top: usize, w: usize, h: usize) -> anyhow::Result<Sensor> {
        let cpp = raw.cpp.max(1);
        let ints: Option<&[u16]> = match &raw.data {
            RawImageData::Integer(v) => Some(v),
            RawImageData::Float(_) => None,
        };
        let floats: Option<&[f32]> = match &raw.data {
            RawImageData::Float(v) => Some(v),
            _ => None,
        };
        let expected = raw.width * raw.height * cpp;
        let len = ints
            .map(|v| v.len())
            .or(floats.map(|v| v.len()))
            .unwrap_or(0);
        if len < expected {
            bail!("RAW data is truncated ({len} of {expected} samples)");
        }
        let white = raw.whitelevel.0.first().copied().unwrap_or(65535).max(1) as f64;
        let float_scale = if floats.is_some() && white <= 1.0 {
            65535.0
        } else {
            1.0
        };
        let white = white * float_scale;
        let sample = |i: usize| -> f64 {
            match (ints, floats) {
                (Some(v), _) => v[i] as f64,
                (_, Some(v)) => (v[i] as f64 * float_scale).clamp(0.0, 65535.0).round(),
                _ => 0.0,
            }
        };
        let bl = &raw.blacklevel;
        let (bw, bh, bcpp) = (bl.width.max(1), bl.height.max(1), bl.cpp.max(1));
        let blacks: Vec<f64> = bl
            .levels
            .iter()
            .map(|r| r.as_f32() as f64 * float_scale)
            .collect();
        let black_at = |row: usize, col: usize, c: usize| -> f64 {
            if blacks.is_empty() {
                return 0.0;
            }
            let i = ((row % bh) * bw + (col % bw)) * bcpp + (c % bcpp);
            blacks.get(i).copied().unwrap_or(blacks[0])
        };
        let black_min = blacks.iter().copied().fold(f64::INFINITY, f64::min);
        let black_min = if black_min.is_finite() {
            black_min
        } else {
            0.0
        };

        let (layout, colors, vals_per_px) = match &raw.photometric {
            RawPhotometricInterpretation::Cfa(cfg) if cpp == 1 => {
                let cfa = &cfg.cfa;
                let (pw, ph) = (cfa.width.max(1), cfa.height.max(1));
                // Pattern cells relative to the visible area's origin.
                let mut cells = Vec::with_capacity(pw * ph);
                for r in 0..ph {
                    for c in 0..pw {
                        cells.push(cfa.color_at(top + r, left + c));
                    }
                }
                let distinct = {
                    let mut d: Vec<usize> = cells.clone();
                    d.sort_unstable();
                    d.dedup();
                    d
                };
                if distinct.iter().any(|&c| c > 3) || distinct.len() < 3 {
                    bail!("unsupported CFA pattern {:?}", cfa.name);
                }
                // LibRaw colour indices: R G B (+ a fourth colour).
                let colors = if distinct.len() == 4 { 4 } else { 3 };
                (
                    Layout::Cfa {
                        pw,
                        ph,
                        colors: cells,
                    },
                    colors,
                    1,
                )
            }
            RawPhotometricInterpretation::LinearRaw if cpp >= 3 => (Layout::Planar, 3, cpp),
            RawPhotometricInterpretation::LinearRaw | RawPhotometricInterpretation::BlackIsZero
                if cpp == 1 =>
            {
                (Layout::Planar, 1, 1)
            }
            other => bail!("unsupported RAW layout {other:?} with {cpp} samples per pixel"),
        };

        let mut values = vec![0u16; w * h * colors.min(vals_per_px).max(1)];
        let per = if vals_per_px == 1 { 1 } else { colors };
        let dmax = values
            .par_chunks_mut(w * per)
            .enumerate()
            .map(|(y, row)| {
                let ry = top + y;
                let mut m = 0f64;
                for x in 0..w {
                    let rx = left + x;
                    for c in 0..per {
                        let v = sample((ry * raw.width + rx) * cpp + c) - black_at(ry, rx, c);
                        let v = v.clamp(0.0, 65535.0);
                        m = m.max(v);
                        row[x * per + c] = v as u16;
                    }
                }
                m
            })
            .reduce(|| 0.0, f64::max);

        // `adjust_maximum`: the real data maximum when close to the white level.
        let mut maximum = (white - black_min).max(1.0);
        if dmax > 0.0 && dmax < maximum && dmax > maximum * ADJUST_MAXIMUM_THR as f64 {
            maximum = dmax;
        }

        let cam_xyz = color_matrix(raw, colors);
        let (rgb_cam, daylight) = match &cam_xyz {
            Some(m) if colors >= 3 => {
                let (rgb_cam, pre) = cam_xyz_coeff(m, colors);
                (Some(rgb_cam), Some(pre))
            }
            _ => (None, None),
        };
        let wb = raw.wb_coeffs;
        let mut pre_mul = [1f64; 4];
        // A monochrome sensor too: LibRaw scales its one channel by
        // `cam_mul[0] / min(cam_mul)` and lets auto-brightness sort it out.
        let camera_wb = wb[..3].iter().all(|v| v.is_finite() && *v > 0.0);
        if camera_wb {
            for c in 0..4 {
                pre_mul[c] = wb[c] as f64;
            }
        } else if let Some(d) = daylight {
            pre_mul = d;
        }
        if pre_mul[1].is_nan() || pre_mul[1] <= 0.0 {
            pre_mul[1] = 1.0;
        }
        if !pre_mul[3].is_finite() || pre_mul[3] <= 0.0 {
            pre_mul[3] = if colors < 4 { pre_mul[1] } else { 1.0 };
        }
        Ok(Sensor {
            w,
            h,
            colors,
            layout,
            values,
            maximum,
            pre_mul,
            rgb_cam,
        })
    }

    fn cfa_2x2(&self) -> bool {
        matches!(&self.layout, Layout::Cfa { pw: 2, ph: 2, .. })
    }

    fn cfa_color(&self, y: usize, x: usize) -> usize {
        match &self.layout {
            Layout::Cfa { pw, ph, colors } => colors[(y % ph) * pw + (x % pw)],
            Layout::Planar => 0,
        }
    }

    /// `scale_colors` with highlight mode 0: every channel by
    /// `pre_mul[c] / min(pre_mul) * 65535 / maximum`, clipped.
    fn scale_colors(&mut self) -> Scaled {
        let dmin = self.pre_mul.iter().copied().fold(f64::INFINITY, f64::min);
        let mut scale = [1f32; 4];
        if dmin > 0.00001 {
            for c in 0..4 {
                // float pre_mul /= dmax (double); * 65535.0 / maximum.
                let p = (self.pre_mul[c] as f32 as f64 / dmin) as f32;
                scale[c] = (p as f64 * 65535.0 / self.maximum) as f32;
            }
        }
        let scale_of =
            |v: u16, c: usize| -> u16 { ((v as f32 * scale[c]) as i32).clamp(0, 65535) as u16 };
        let mut values = std::mem::take(&mut self.values);
        match &self.layout {
            Layout::Cfa { .. } => {
                values
                    .par_chunks_mut(self.w)
                    .enumerate()
                    .for_each(|(y, row)| {
                        for (x, v) in row.iter_mut().enumerate() {
                            *v = scale_of(*v, self.cfa_color(y, x));
                        }
                    });
            }
            Layout::Planar => {
                let n = self.colors;
                values.par_chunks_mut(n).for_each(|px| {
                    for c in 0..n {
                        px[c] = scale_of(px[c], c);
                    }
                });
            }
        }
        Scaled { values }
    }

    fn convert_to_rgb(&self, planes: &[u16], n: usize) -> Converted {
        let colors = self.colors;
        let pixels: Vec<[u16; 3]> = (0..n)
            .into_par_iter()
            .map(|i| {
                let px = &planes[i * colors..i * colors + colors];
                match (&self.rgb_cam, colors) {
                    (Some(m), _) => {
                        let mut out = [0f32; 3];
                        for (o, row) in out.iter_mut().zip(m.iter()) {
                            for c in 0..colors {
                                *o += row[c] * px[c] as f32;
                            }
                        }
                        out.map(|v| (v as i32).clamp(0, 65535) as u16)
                    }
                    (None, 1) => [px[0]; 3],
                    (None, _) => [px[0], px[1], px[2]],
                }
            })
            .collect();
        let hist = pixels
            .par_chunks(1 << 16)
            .map(|chunk| {
                let mut h = vec![[0u32; 0x2000]; 3];
                for p in chunk {
                    for c in 0..3 {
                        h[c][(p[c] >> 3) as usize] += 1;
                    }
                }
                h
            })
            .reduce(
                || vec![[0u32; 0x2000]; 3],
                |mut a, b| {
                    for c in 0..3 {
                        for (x, y) in a[c].iter_mut().zip(b[c].iter()) {
                            *x += y;
                        }
                    }
                    a
                },
            );
        Converted { pixels, hist }
    }
}

impl Scaled {
    /// LibRaw `half_size`: one pixel per 2x2 cell, each sample into its
    /// colour; the two greens are separate channels that `convert_to_rgb`
    /// averages (`mix_green`). Cells cut by an odd edge keep LibRaw's
    /// arithmetic: a missing colour is 0, a lone green is halved.
    fn half_2x2(&self, s: &Sensor) -> (Vec<u16>, usize, usize) {
        let (iw, ih) = (s.w.div_ceil(2), s.h.div_ceil(2));
        let colors = s.colors;
        let mut per_cell = [0u32; 4];
        for dy in 0..2 {
            for dx in 0..2 {
                per_cell[s.cfa_color(dy, dx)] += 1;
            }
        }
        let mut out = vec![0u16; iw * ih * colors];
        out.par_chunks_mut(iw * colors)
            .enumerate()
            .for_each(|(y, row)| {
                for x in 0..iw {
                    let mut acc = [0u32; 4];
                    for dy in 0..2 {
                        for dx in 0..2 {
                            let (sy, sx) = (y * 2 + dy, x * 2 + dx);
                            if sy < s.h && sx < s.w {
                                acc[s.cfa_color(sy, sx)] += self.values[sy * s.w + sx] as u32;
                            }
                        }
                    }
                    for c in 0..colors {
                        row[x * colors + c] = (acc[c] / per_cell[c].max(1)) as u16;
                    }
                }
            });
        (out, iw, ih)
    }

    /// LibRaw's AHD (2x2 RGB Bayer).
    fn ahd(&self, s: &Sensor) -> (Vec<u16>, usize, usize) {
        let mut img: Vec<[u16; 3]> = vec![[0; 3]; s.w * s.h];
        img.par_chunks_mut(s.w).enumerate().for_each(|(y, row)| {
            for (x, px) in row.iter_mut().enumerate() {
                px[s.cfa_color(y, x)] = self.values[y * s.w + x];
            }
        });
        let identity = [
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
        ];
        let cam = s.rgb_cam.as_ref().unwrap_or(&identity);
        super::ahd::ahd(&mut img, s.w, s.h, &|y, x| s.cfa_color(y, x), cam);
        (img.into_iter().flatten().collect(), s.w, s.h)
    }

    /// Bilinear demosaic (other CFA layouts): each missing colour is the mean of that colour's
    /// samples in the 3x3 (else 5x5) neighbourhood.
    fn demosaic(&self, s: &Sensor) -> (Vec<u16>, usize, usize) {
        let (w, h, colors) = (s.w, s.h, s.colors);
        let mut out = vec![0u16; w * h * colors];
        out.par_chunks_mut(w * colors)
            .enumerate()
            .for_each(|(y, row)| {
                for x in 0..w {
                    let own = s.cfa_color(y, x);
                    for c in 0..colors {
                        let v = if c == own {
                            self.values[y * w + x] as u32
                        } else {
                            let mut v = None;
                            for r in [1isize, 2] {
                                let (mut sum, mut n) = (0u32, 0u32);
                                for dy in -r..=r {
                                    for dx in -r..=r {
                                        let (yy, xx) = (y as isize + dy, x as isize + dx);
                                        if yy < 0 || xx < 0 || yy >= h as isize || xx >= w as isize
                                        {
                                            continue;
                                        }
                                        let (yy, xx) = (yy as usize, xx as usize);
                                        if s.cfa_color(yy, xx) == c {
                                            sum += self.values[yy * w + xx] as u32;
                                            n += 1;
                                        }
                                    }
                                }
                                v = sum.checked_div(n);
                                if v.is_some() {
                                    break;
                                }
                            }
                            v.unwrap_or(0)
                        };
                        row[x * colors + c] = v as u16;
                    }
                }
            });
        (out, w, h)
    }
}

/// 2x box shrink for layouts `half_2x2` does not cover.
fn box_half(v: &[u16], w: usize, h: usize, colors: usize) -> (Vec<u16>, usize, usize) {
    let (iw, ih) = (w.div_ceil(2), h.div_ceil(2));
    let mut out = vec![0u16; iw * ih * colors];
    out.par_chunks_mut(iw * colors)
        .enumerate()
        .for_each(|(y, row)| {
            for x in 0..iw {
                for c in 0..colors {
                    let (mut sum, mut n) = (0u32, 0u32);
                    for dy in 0..2 {
                        for dx in 0..2 {
                            let (sy, sx) = (y * 2 + dy, x * 2 + dx);
                            if sy < h && sx < w {
                                sum += v[(sy * w + sx) * colors + c] as u32;
                                n += 1;
                            }
                        }
                    }
                    row[x * colors + c] = (sum / n.max(1)) as u16;
                }
            }
        });
    (out, iw, ih)
}

/// The XYZ -> camera matrix LibRaw would use (D65 preferred), `colors` rows.
fn color_matrix(raw: &RawImage, colors: usize) -> Option<Vec<[f64; 3]>> {
    use rawler::imgop::xyz::Illuminant;
    let m = raw.color_matrix.get(&Illuminant::D65).or_else(|| {
        let mut keys: Vec<_> = raw.color_matrix.keys().collect();
        keys.sort_by_key(|k| **k as u16);
        keys.last().and_then(|k| raw.color_matrix.get(*k))
    })?;
    if m.len() < colors * 3 || m.iter().all(|v| *v == 0.0) {
        return None;
    }
    Some(
        (0..colors)
            .map(|i| [m[i * 3] as f64, m[i * 3 + 1] as f64, m[i * 3 + 2] as f64])
            .collect(),
    )
}

/// dcraw `cam_xyz_coeff`: `rgb_cam` and the daylight `pre_mul`.
fn cam_xyz_coeff(cam_xyz: &[[f64; 3]], colors: usize) -> ([[f32; 4]; 3], [f64; 4]) {
    let mut cam_rgb = [[0f64; 3]; 4];
    let mut pre_mul = [1f64; 4];
    for i in 0..colors {
        for j in 0..3 {
            cam_rgb[i][j] = (0..3).map(|k| cam_xyz[i][k] * XYZ_RGB[k][j]).sum();
        }
    }
    for i in 0..colors {
        let num: f64 = cam_rgb[i].iter().sum();
        for j in 0..3 {
            cam_rgb[i][j] /= num;
        }
        pre_mul[i] = 1.0 / num;
    }
    let inverse = pseudoinverse(&cam_rgb, colors);
    let mut rgb_cam = [[0f32; 4]; 3];
    for i in 0..3 {
        for j in 0..colors {
            rgb_cam[i][j] = inverse[j][i] as f32;
        }
    }
    (rgb_cam, pre_mul)
}

/// dcraw `pseudoinverse` (`in` is size x 3, the result size x 3).
fn pseudoinverse(inm: &[[f64; 3]; 4], size: usize) -> [[f64; 3]; 4] {
    let mut work = [[0f64; 6]; 3];
    for i in 0..3 {
        for j in 0..6 {
            work[i][j] = if j == i + 3 { 1.0 } else { 0.0 };
        }
        for j in 0..3 {
            for k in 0..size {
                work[i][j] += inm[k][i] * inm[k][j];
            }
        }
    }
    for i in 0..3 {
        let num = work[i][i];
        for j in 0..6 {
            work[i][j] /= num;
        }
        for k in 0..3 {
            if k == i {
                continue;
            }
            let num = work[k][i];
            for j in 0..6 {
                work[k][j] -= work[i][j] * num;
            }
        }
    }
    let mut out = [[0f64; 3]; 4];
    for i in 0..size {
        for j in 0..3 {
            out[i][j] = (0..3).map(|k| work[j][k + 3] * inm[i][k]).sum();
        }
    }
    out
}

/// The auto-brightness white point (`t_white`) from the 13-bit histograms.
fn auto_white(hist: &[[u32; 0x2000]], pixels: usize) -> i32 {
    let perc = (pixels as f32 * AUTO_BRIGHT_THR) as i64;
    let mut white = 0;
    for h in hist {
        let mut total = 0i64;
        let mut val = 0x2000i32;
        loop {
            val -= 1;
            if val <= 32 {
                break;
            }
            total += h[val as usize] as i64;
            if total > perc {
                break;
            }
        }
        white = white.max(val);
    }
    white
}

/// LibRaw `gamma_curve(gamm[0], gamm[1], 2, (t_white << 3) / bright)`.
fn gamma_curve(t_white: i32) -> Vec<u16> {
    let imax = t_white << 3;
    let (pwr, ts) = (GAMMA_POWER, GAMMA_SLOPE);
    let mut g = [pwr, ts, 0.0, 0.0, 0.0, 0.0];
    let mut bnd = [0f64, 0.0];
    bnd[(g[1] >= 1.0) as usize] = 1.0;
    if g[1] != 0.0 && (g[1] - 1.0) * (g[0] - 1.0) <= 0.0 {
        for _ in 0..48 {
            g[2] = (bnd[0] + bnd[1]) / 2.0;
            let idx = if g[0] != 0.0 {
                ((g[2] / g[1]).powf(-g[0]) - 1.0) / g[0] - 1.0 / g[2] > -1.0
            } else {
                g[2] / (1.0 - 1.0 / g[2]).exp() < g[1]
            };
            bnd[idx as usize] = g[2];
        }
        g[3] = g[2] / g[1];
        if g[0] != 0.0 {
            g[4] = g[2] * (1.0 / g[0] - 1.0);
        }
    }
    let mut curve = vec![0xffffu16; 0x10000];
    for (i, out) in curve.iter_mut().enumerate() {
        let r = i as f64 / imax as f64;
        if r < 1.0 {
            let v = if r < g[3] {
                r * g[1]
            } else if g[0] != 0.0 {
                r.powf(g[0]) * (1.0 + g[4]) - g[4]
            } else {
                r.ln() * g[2] + 1.0
            };
            *out = (0x10000 as f64 * v) as i64 as u16;
        }
    }
    curve
}

/// `copy_mem_image` at 8 bits: the curve, then LibRaw's flip.
fn output(px: &[[u16; 3]], iw: usize, ih: usize, flip: u8, curve: &[u16]) -> RgbImage {
    let (ow, oh) = if flip & 4 != 0 { (ih, iw) } else { (iw, ih) };
    let mut buf = vec![0u8; ow * oh * 3];
    buf.par_chunks_mut(ow * 3)
        .enumerate()
        .for_each(|(row, line)| {
            for col in 0..ow {
                let (mut r, mut c) = (row, col);
                if flip & 4 != 0 {
                    std::mem::swap(&mut r, &mut c);
                }
                if flip & 2 != 0 {
                    r = ih - 1 - r;
                }
                if flip & 1 != 0 {
                    c = iw - 1 - c;
                }
                let p = px[r * iw + c];
                for k in 0..3 {
                    line[col * 3 + k] = (curve[p[k] as usize] >> 8) as u8;
                }
            }
        });
    RgbImage::from_raw(ow as u32, oh as u32, buf).expect("buffer size")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flips_match_libraw() {
        assert_eq!(
            (1..=8).map(libraw_flip).collect::<Vec<_>>(),
            vec![0, 1, 3, 2, 4, 6, 7, 5]
        );
    }

    #[test]
    fn gamma_curve_is_bt709_like() {
        let c = gamma_curve(0x1000);
        assert_eq!(c[0], 0);
        assert_eq!(c[0x8000], 0xffff);
        // BT.709: 0.5 -> 1.099 * 0.5^0.45 - 0.099 = 0.705.
        assert!((0xb300..0xb600).contains(&c[0x4000]), "{:#x}", c[0x4000]);
    }
}
