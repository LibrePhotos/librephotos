//! Pillow's `Image.resize` for 8-bit images, ported line by line from
//! `libImaging/Resample.c` (Pillow 9-12): the same coefficient table, the
//! same 22-bit fixed point, horizontal pass first over only the rows the
//! vertical pass reads, u8 between the passes. Bit-exact with Pillow
//! (verified by the `preprocess` goldens), which a SIMD resizer is not.

/// `Image.Resampling` filters.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Filter {
    /// `Image.BOX` (support 0.5).
    Box,
    /// `Image.BILINEAR` (triangle, support 1).
    Bilinear,
    /// `Image.HAMMING` (support 1).
    Hamming,
    /// `Image.BICUBIC` (a = -0.5, support 2).
    Bicubic,
    /// `Image.LANCZOS` (support 3).
    Lanczos,
}

impl Filter {
    fn support(self) -> f64 {
        match self {
            Filter::Box => 0.5,
            Filter::Bilinear | Filter::Hamming => 1.0,
            Filter::Bicubic => 2.0,
            Filter::Lanczos => 3.0,
        }
    }

    fn eval(self, x: f64) -> f64 {
        match self {
            Filter::Box => {
                if x > -0.5 && x <= 0.5 {
                    1.0
                } else {
                    0.0
                }
            }
            Filter::Bilinear => {
                let x = x.abs();
                if x < 1.0 { 1.0 - x } else { 0.0 }
            }
            Filter::Hamming => {
                let x = x.abs();
                if x == 0.0 {
                    1.0
                } else if x >= 1.0 {
                    0.0
                } else {
                    let x = x * std::f64::consts::PI;
                    x.sin() / x * (0.54 + 0.46 * x.cos())
                }
            }
            Filter::Bicubic => {
                const A: f64 = -0.5;
                let x = x.abs();
                if x < 1.0 {
                    ((A + 2.0) * x - (A + 3.0)) * x * x + 1.0
                } else if x < 2.0 {
                    (((x - 5.0) * x + 8.0) * x - 4.0) * A
                } else {
                    0.0
                }
            }
            Filter::Lanczos => {
                fn sinc(x: f64) -> f64 {
                    if x == 0.0 {
                        return 1.0;
                    }
                    let x = x * std::f64::consts::PI;
                    x.sin() / x
                }
                if (-3.0..3.0).contains(&x) {
                    sinc(x) * sinc(x / 3.0)
                } else {
                    0.0
                }
            }
        }
    }
}

const PRECISION_BITS: u32 = 32 - 8 - 2;

struct Coeffs {
    ksize: usize,
    /// (xmin, count) per output pixel.
    bounds: Vec<(usize, usize)>,
    /// `ksize` fixed-point weights per output pixel.
    kk: Vec<i32>,
}

/// `precompute_coeffs` + `normalize_coeffs_8bpc`.
fn precompute(in_size: usize, in0: f64, in1: f64, out_size: usize, filter: Filter) -> Coeffs {
    precompute_range(in_size, in0, in1, out_size, filter, 0..out_size)
}

/// [`precompute`] for the output pixels in `range` only (each pixel's
/// coefficients depend on its own position alone).
fn precompute_range(
    in_size: usize,
    in0: f64,
    in1: f64,
    out_size: usize,
    filter: Filter,
    range: std::ops::Range<usize>,
) -> Coeffs {
    let scale = (in1 - in0) / out_size as f64;
    let filterscale = scale.max(1.0);
    let support = filter.support() * filterscale;
    let ksize = support.ceil() as usize * 2 + 1;
    let mut bounds = Vec::with_capacity(range.len());
    let mut kk = vec![0i32; range.len() * ksize];
    let mut k = vec![0f64; ksize];
    for (i, xx) in range.enumerate() {
        let center = in0 + (xx as f64 + 0.5) * scale;
        let ss = 1.0 / filterscale;
        // C's (int) cast truncates toward zero.
        let xmin = ((center - support + 0.5) as i64).max(0) as usize;
        let xmax = ((center + support + 0.5) as i64).min(in_size as i64) as usize;
        let count = xmax.saturating_sub(xmin);
        let mut ww = 0.0;
        for (x, kx) in k.iter_mut().enumerate().take(count) {
            let w = filter.eval((x as f64 + xmin as f64 - center + 0.5) * ss);
            *kx = w;
            ww += w;
        }
        let row = &mut kk[i * ksize..(i + 1) * ksize];
        for x in 0..count {
            let w = if ww != 0.0 { k[x] / ww } else { k[x] };
            let f = w * (1u32 << PRECISION_BITS) as f64;
            row[x] = if w < 0.0 {
                (-0.5 + f) as i32
            } else {
                (0.5 + f) as i32
            };
        }
        bounds.push((xmin, count));
    }
    Coeffs { ksize, bounds, kk }
}

#[inline]
fn clip8(v: i32) -> u8 {
    (v >> PRECISION_BITS).clamp(0, 255) as u8
}

/// `Image.resize((dst_w, dst_h), filter)` of an interleaved 8-bit image with
/// `channels` channels (1, 3 or 4), `src.len() == w * h * channels`.
pub fn resize(
    src: &[u8],
    w: usize,
    h: usize,
    channels: usize,
    dst_w: usize,
    dst_h: usize,
    filter: Filter,
) -> Vec<u8> {
    assert_eq!(src.len(), w * h * channels, "image buffer size");
    if dst_w == 0 || dst_h == 0 {
        return Vec::new();
    }
    let need_h = dst_w != w;
    let need_v = dst_h != h;
    if !need_h && !need_v {
        return src.to_vec();
    }
    let horiz = precompute(w, 0.0, w as f64, dst_w, filter);
    let mut vert = precompute(h, 0.0, h as f64, dst_h, filter);

    let (tmp, tmp_w, tmp_h);
    let src = if need_h {
        let first = vert.bounds[0].0;
        let last = vert.bounds[dst_h - 1].0 + vert.bounds[dst_h - 1].1;
        for b in &mut vert.bounds {
            b.0 -= first;
        }
        let rows = last - first;
        let mut out = vec![0u8; dst_w * rows * channels];
        for yy in 0..rows {
            let line = &src[(yy + first) * w * channels..(yy + first + 1) * w * channels];
            let out_line = &mut out[yy * dst_w * channels..(yy + 1) * dst_w * channels];
            for (xx, &(xmin, count)) in horiz.bounds.iter().enumerate() {
                let k = &horiz.kk[xx * horiz.ksize..xx * horiz.ksize + count];
                for c in 0..channels {
                    let mut ss = 1i32 << (PRECISION_BITS - 1);
                    for (x, &kx) in k.iter().enumerate() {
                        ss = ss.wrapping_add(line[(x + xmin) * channels + c] as i32 * kx);
                    }
                    out_line[xx * channels + c] = clip8(ss);
                }
            }
        }
        tmp = out;
        tmp_w = dst_w;
        tmp_h = rows;
        &tmp[..]
    } else {
        tmp_w = w;
        tmp_h = h;
        src
    };
    if !need_v {
        return src.to_vec();
    }
    debug_assert!(tmp_h >= 1);
    let stride = tmp_w * channels;
    let mut out = vec![0u8; tmp_w * dst_h * channels];
    for (yy, &(ymin, count)) in vert.bounds.iter().enumerate() {
        let k = &vert.kk[yy * vert.ksize..yy * vert.ksize + count];
        let out_line = &mut out[yy * stride..(yy + 1) * stride];
        for (i, o) in out_line.iter_mut().enumerate() {
            let mut ss = 1i32 << (PRECISION_BITS - 1);
            for (y, &ky) in k.iter().enumerate() {
                ss = ss.wrapping_add(src[(y + ymin) * stride + i] as i32 * ky);
            }
            *o = clip8(ss);
        }
    }
    out
}

/// `Image.resize` of an RGB image.
pub fn resize_rgb(
    img: &image::RgbImage,
    dst_w: u32,
    dst_h: u32,
    filter: Filter,
) -> image::RgbImage {
    let out = resize(
        img.as_raw(),
        img.width() as usize,
        img.height() as usize,
        3,
        dst_w as usize,
        dst_h as usize,
        filter,
    );
    image::RgbImage::from_raw(dst_w, dst_h, out).expect("resize output size")
}

/// `Image.crop((left, top, left + w, top + h))` inside the image.
pub fn crop_rgb(img: &image::RgbImage, left: u32, top: u32, w: u32, h: u32) -> image::RgbImage {
    image::imageops::crop_imm(img, left, top, w, h).to_image()
}

/// The CLIP-family preprocessing step: shortest edge to `size` with
/// `round()` on the long edge (never below `size`), then the centred
/// `size` x `size` crop with Pillow's `(width - size) // 2` offsets.
pub fn resize_shortest_edge_center_crop(
    img: &image::RgbImage,
    size: u32,
    filter: Filter,
) -> image::RgbImage {
    let (w, h) = (img.width() as f64, img.height() as f64);
    let scale = size as f64 / w.min(h);
    let nw = (py_round(w * scale) as u32).max(size);
    let nh = (py_round(h * scale) as u32).max(size);
    let left = (nw - size) / 2;
    let top = (nh - size) / 2;
    // Only the crop is resampled: a 1-pixel-high panorama would otherwise
    // resize to 256 x millions (gigabytes) before the crop.
    let out = resize_crop(
        img.as_raw(),
        img.width() as usize,
        img.height() as usize,
        3,
        (nw as usize, nh as usize),
        (left as usize, top as usize, size as usize, size as usize),
        filter,
    );
    image::RgbImage::from_raw(size, size, out).expect("resize output size")
}

/// `Image.resize(dst, filter).crop((x, y, x + cw, y + ch))` without
/// resampling the pixels outside the crop; the same bits as resizing the
/// whole image first.
pub fn resize_crop(
    src: &[u8],
    w: usize,
    h: usize,
    channels: usize,
    (dst_w, dst_h): (usize, usize),
    (x0, y0, cw, ch): (usize, usize, usize, usize),
    filter: Filter,
) -> Vec<u8> {
    assert_eq!(src.len(), w * h * channels, "image buffer size");
    assert!(
        x0 + cw <= dst_w && y0 + ch <= dst_h,
        "crop inside the output"
    );
    if cw == 0 || ch == 0 {
        return Vec::new();
    }
    let need_h = dst_w != w;
    let need_v = dst_h != h;
    let vert = need_v.then(|| precompute_range(h, 0.0, h as f64, dst_h, filter, y0..y0 + ch));
    // Source rows the vertical pass reads (the crop rows themselves without one).
    let (first, last) = match &vert {
        Some(v) => (v.bounds[0].0, v.bounds[ch - 1].0 + v.bounds[ch - 1].1),
        None => (y0, y0 + ch),
    };
    let rows = last - first;
    let row_len = cw * channels;
    let mut tmp = vec![0u8; rows * row_len];
    if need_h {
        let horiz = precompute_range(w, 0.0, w as f64, dst_w, filter, x0..x0 + cw);
        for yy in 0..rows {
            let line = &src[(yy + first) * w * channels..(yy + first + 1) * w * channels];
            let out_line = &mut tmp[yy * row_len..(yy + 1) * row_len];
            for (xx, &(xmin, count)) in horiz.bounds.iter().enumerate() {
                let k = &horiz.kk[xx * horiz.ksize..xx * horiz.ksize + count];
                for c in 0..channels {
                    let mut ss = 1i32 << (PRECISION_BITS - 1);
                    for (x, &kx) in k.iter().enumerate() {
                        ss = ss.wrapping_add(line[(x + xmin) * channels + c] as i32 * kx);
                    }
                    out_line[xx * channels + c] = clip8(ss);
                }
            }
        }
    } else {
        for yy in 0..rows {
            let at = ((yy + first) * w + x0) * channels;
            tmp[yy * row_len..(yy + 1) * row_len].copy_from_slice(&src[at..at + row_len]);
        }
    }
    let Some(vert) = vert else {
        return tmp;
    };
    let mut out = vec![0u8; ch * row_len];
    for (yy, &(ymin, count)) in vert.bounds.iter().enumerate() {
        let k = &vert.kk[yy * vert.ksize..yy * vert.ksize + count];
        let out_line = &mut out[yy * row_len..(yy + 1) * row_len];
        for (i, o) in out_line.iter_mut().enumerate() {
            let mut ss = 1i32 << (PRECISION_BITS - 1);
            for (y, &ky) in k.iter().enumerate() {
                ss = ss.wrapping_add(tmp[(y + ymin - first) * row_len + i] as i32 * ky);
            }
            *o = clip8(ss);
        }
    }
    out
}

/// Python's `round()` (half to even) for non-negative values.
pub fn py_round(x: f64) -> f64 {
    let r = x.round();
    if (x - x.trunc()).abs() == 0.5 && r % 2.0 != 0.0 {
        r - x.signum()
    } else {
        r
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resize_crop_is_resize_then_crop() {
        let mut seed = 7u32;
        let mut noise = move || {
            seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12345);
            (seed >> 16) as u8
        };
        // (w, h, dst_w, dst_h): down, up, one axis unchanged, both unchanged.
        let cases = [
            (37, 23, 16, 11),
            (5, 9, 40, 72),
            (30, 20, 30, 9),
            (20, 30, 9, 30),
            (12, 12, 12, 12),
            (3, 1, 768, 256),
        ];
        for (w, h, dw, dh) in cases {
            let src: Vec<u8> = (0..w * h * 3).map(|_| noise()).collect();
            for filter in [Filter::Bilinear, Filter::Bicubic, Filter::Lanczos] {
                let full = resize(&src, w, h, 3, dw, dh, filter);
                for (x0, y0, cw, ch) in [(0, 0, dw, dh), (dw / 3, dh / 4, dw / 2, dh / 2)] {
                    let got = resize_crop(&src, w, h, 3, (dw, dh), (x0, y0, cw, ch), filter);
                    let want: Vec<u8> = (y0..y0 + ch)
                        .flat_map(|y| full[(y * dw + x0) * 3..(y * dw + x0 + cw) * 3].to_vec())
                        .collect();
                    assert_eq!(got, want, "{w}x{h} -> {dw}x{dh} crop {x0},{y0} {filter:?}");
                }
            }
        }
    }

    #[test]
    fn panorama_crop_stays_small() {
        // 1 x 20000 would resize to 256 x 5_120_000 (3.9 GB) before cropping.
        let img = image::RgbImage::from_pixel(1, 20_000, image::Rgb([10, 200, 30]));
        let out = resize_shortest_edge_center_crop(&img, 256, Filter::Bilinear);
        assert_eq!(out.dimensions(), (256, 256));
        assert!(out.pixels().all(|p| p.0 == [10, 200, 30]));
    }
}
