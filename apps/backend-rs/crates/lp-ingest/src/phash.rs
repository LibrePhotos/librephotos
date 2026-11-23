//! `imagehash.phash(img, hash_size=8)` as `api/perceptual_hash.py` calls it
//! on the big WebP thumbnail, reproduced step by step so the hashes match
//! Python bit for bit: Pillow's fixed-point RGB->L, Pillow's two-pass
//! LANCZOS resample to 32x32 (8-bit fixed-point coefficients), a type-II DCT
//! over both axes, and numpy's median of the top-left 8x8 block.

use std::f64::consts::PI;

const PRECISION_BITS: i32 = 32 - 8 - 2;

/// Pillow `ImagingConvert` RGB -> L: `(r*19595 + g*38470 + b*7471 + 0x8000) >> 16`.
pub fn luma(rgb: &[u8], channels: usize) -> Vec<u8> {
    rgb.chunks_exact(channels)
        .map(|p| {
            let (r, g, b) = (p[0] as u32, p[1] as u32, p[2] as u32);
            ((r * 19595 + g * 38470 + b * 7471 + 0x8000) >> 16) as u8
        })
        .collect()
}

fn sinc(x: f64) -> f64 {
    if x == 0.0 {
        1.0
    } else {
        let x = x * PI;
        x.sin() / x
    }
}

fn lanczos(x: f64) -> f64 {
    if (-3.0..3.0).contains(&x) {
        sinc(x) * sinc(x / 3.0)
    } else {
        0.0
    }
}

struct Coeffs {
    ksize: usize,
    bounds: Vec<(usize, usize)>,
    kk: Vec<i32>,
}

/// `precompute_coeffs` + `normalize_coeffs_8bpc` from Pillow's Resample.c.
fn precompute(in_size: usize, in0: f32, in1: f32, out_size: usize) -> Coeffs {
    let scale = (in1 - in0) as f64 / out_size as f64;
    let filterscale = if scale < 1.0 { 1.0 } else { scale };
    let support = 3.0 * filterscale;
    let ksize = support.ceil() as usize * 2 + 1;
    let mut prekk = vec![0f64; out_size * ksize];
    let mut bounds = Vec::with_capacity(out_size);
    for xx in 0..out_size {
        let center = in0 as f64 + (xx as f64 + 0.5) * scale;
        let ss = 1.0 / filterscale;
        let mut xmin = (center - support + 0.5) as i64;
        if xmin < 0 {
            xmin = 0;
        }
        let mut xmax = (center + support + 0.5) as i64;
        if xmax > in_size as i64 {
            xmax = in_size as i64;
        }
        let xmax = (xmax - xmin).max(0) as usize;
        let k = &mut prekk[xx * ksize..(xx + 1) * ksize];
        let mut ww = 0.0;
        for (x, kx) in k.iter_mut().enumerate().take(xmax) {
            let w = lanczos((x as f64 + xmin as f64 - center + 0.5) * ss);
            *kx = w;
            ww += w;
        }
        for kx in k.iter_mut().take(xmax) {
            if ww != 0.0 {
                *kx /= ww;
            }
        }
        bounds.push((xmin as usize, xmax));
    }
    let kk = prekk
        .iter()
        .map(|&v| {
            if v < 0.0 {
                (-0.5 + v * (1i64 << PRECISION_BITS) as f64) as i32
            } else {
                (0.5 + v * (1i64 << PRECISION_BITS) as f64) as i32
            }
        })
        .collect();
    Coeffs { ksize, bounds, kk }
}

fn clip8(v: i64) -> u8 {
    if v >= (1i64 << PRECISION_BITS << 8) {
        255
    } else if v <= 0 {
        0
    } else {
        (v >> PRECISION_BITS) as u8
    }
}

/// `Image.resize((w, h), LANCZOS)` on an L image (`ImagingResampleInner`).
pub fn resize_lanczos(src: &[u8], w: usize, h: usize, out_w: usize, out_h: usize) -> Vec<u8> {
    let need_h = out_w != w;
    let need_v = out_h != h;
    let horiz = precompute(w, 0.0, w as f32, out_w);
    let mut vert = precompute(h, 0.0, h as f32, out_h);
    let ybox_first = vert.bounds[0].0;
    let ybox_last = vert.bounds[out_h - 1].0 + vert.bounds[out_h - 1].1;

    let (mut cur, mut cur_w, mut cur_h) = (src.to_vec(), w, h);
    if need_h {
        for b in vert.bounds.iter_mut() {
            b.0 -= ybox_first;
        }
        let th = ybox_last - ybox_first;
        let mut tmp = vec![0u8; out_w * th];
        for yy in 0..th {
            let row = &src[(yy + ybox_first) * w..(yy + ybox_first + 1) * w];
            for xx in 0..out_w {
                let (xmin, xmax) = horiz.bounds[xx];
                let k = &horiz.kk[xx * horiz.ksize..];
                let mut ss: i64 = 1 << (PRECISION_BITS - 1);
                for x in 0..xmax {
                    ss += row[x + xmin] as i64 * k[x] as i64;
                }
                tmp[yy * out_w + xx] = clip8(ss);
            }
        }
        cur = tmp;
        cur_w = out_w;
        cur_h = th;
    }
    if need_v {
        let mut out = vec![0u8; cur_w * out_h];
        for yy in 0..out_h {
            let (ymin, ymax) = vert.bounds[yy];
            let k = &vert.kk[yy * vert.ksize..];
            for xx in 0..cur_w {
                let mut ss: i64 = 1 << (PRECISION_BITS - 1);
                for y in 0..ymax {
                    ss += cur[(y + ymin) * cur_w + xx] as i64 * k[y] as i64;
                }
                out[yy * cur_w + xx] = clip8(ss);
            }
        }
        cur = out;
        cur_h = out_h;
    }
    debug_assert_eq!(cur.len(), cur_w * cur_h);
    cur
}

/// scipy.fftpack.dct type II, unnormalized: `2 * sum x[n] cos(pi k (2n+1) / 2N)`.
fn dct_ii(input: &[f64], out: &mut [f64]) {
    let n = input.len();
    for (k, o) in out.iter_mut().enumerate() {
        let mut s = 0.0;
        for (i, x) in input.iter().enumerate() {
            s += x * (PI * k as f64 * (2 * i + 1) as f64 / (2 * n) as f64).cos();
        }
        *o = 2.0 * s;
    }
}

/// pHash of an 8-bit L image as imagehash's hex string (16 hex digits).
pub fn phash_luma(l: &[u8], w: usize, h: usize) -> String {
    const HASH: usize = 8;
    const SIZE: usize = 32;
    let small = resize_lanczos(l, w, h, SIZE, SIZE);
    let pixels: Vec<f64> = small.iter().map(|&v| v as f64).collect();
    // dct(dct(pixels, axis=0), axis=1)
    let mut cols = vec![0f64; SIZE * SIZE];
    let mut col_in = [0f64; SIZE];
    let mut col_out = [0f64; SIZE];
    for x in 0..SIZE {
        for y in 0..SIZE {
            col_in[y] = pixels[y * SIZE + x];
        }
        dct_ii(&col_in, &mut col_out);
        for y in 0..SIZE {
            cols[y * SIZE + x] = col_out[y];
        }
    }
    let mut low = [0f64; HASH * HASH];
    let mut row_out = [0f64; SIZE];
    for y in 0..HASH {
        dct_ii(&cols[y * SIZE..(y + 1) * SIZE], &mut row_out);
        low[y * HASH..(y + 1) * HASH].copy_from_slice(&row_out[..HASH]);
    }
    let mut sorted = low.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let med = (sorted[31] + sorted[32]) / 2.0;
    let mut bits: u64 = 0;
    for v in low {
        bits = (bits << 1) | u64::from(v > med);
    }
    format!("{bits:016x}")
}

/// pHash of decoded RGB/RGBA pixels (Pillow converts RGBA to RGB, then L).
pub fn phash_rgb(pixels: &[u8], channels: usize, w: usize, h: usize) -> String {
    phash_luma(&luma(pixels, channels), w, h)
}

/// Decode a WebP file (libwebp, as Pillow does) and hash it.
pub fn phash_webp_file(path: &std::path::Path) -> Option<String> {
    phash_webp_file_keep(path, false).0
}

/// [`phash_webp_file`], also returning the decoded RGB pixels when `keep`
/// (inline ML from the big WebP: one decode for the hash and the models).
pub fn phash_webp_file_keep(
    path: &std::path::Path,
    keep: bool,
) -> (Option<String>, Option<image::RgbImage>) {
    let Ok(data) = std::fs::read(path) else {
        return (None, None);
    };
    let Some(img) = webp::Decoder::new(&data).decode() else {
        return (None, None);
    };
    let channels = if img.is_alpha() { 4 } else { 3 };
    let (w, h) = (img.width(), img.height());
    let hash = phash_rgb(&img, channels, w as usize, h as usize);
    let rgb = if !keep {
        None
    } else if channels == 3 {
        image::RgbImage::from_raw(w, h, img.to_vec())
    } else {
        let px: Vec<u8> = img
            .chunks_exact(4)
            .flat_map(|p| [p[0], p[1], p[2]])
            .collect();
        image::RgbImage::from_raw(w, h, px)
    };
    (Some(hash), rgb)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn luma_matches_pillow() {
        assert_eq!(
            luma(&[255, 255, 255, 0, 0, 0, 10, 200, 30], 3),
            vec![255, 0, 124]
        );
    }

    #[test]
    fn identity_resize_keeps_pixels() {
        let src: Vec<u8> = (0..64u32).map(|v| (v * 3) as u8).collect();
        assert_eq!(resize_lanczos(&src, 8, 8, 8, 8), src);
    }

    #[test]
    fn gradient_hash_is_stable() {
        let l: Vec<u8> = (0..100 * 80).map(|i| ((i % 100) * 2) as u8).collect();
        let h = phash_luma(&l, 100, 80);
        assert_eq!(h.len(), 16);
        assert_eq!(h, phash_luma(&l, 100, 80));
    }
}
