//! `Thumbnail._get_dominant_color`: the small thumbnail shrunk into a
//! 100x100 box (Pillow `thumbnail`, BICUBIC), quantized to 16 colours by
//! median cut, the most frequent palette entry as `"[r, g, b]"`. The resize
//! follows Pillow's fixed-point resampler; the median cut is a close
//! reimplementation (the value is cosmetic: a placeholder tint).

use std::path::Path;

const PRECISION_BITS: i32 = 32 - 8 - 2;

fn bicubic(x: f64) -> f64 {
    let a = -0.5;
    let x = x.abs();
    if x < 1.0 {
        ((a + 2.0) * x - (a + 3.0)) * x * x + 1.0
    } else if x < 2.0 {
        (((x - 5.0) * x + 8.0) * x - 4.0) * a
    } else {
        0.0
    }
}

struct Coeffs {
    ksize: usize,
    bounds: Vec<(usize, usize)>,
    kk: Vec<i32>,
}

fn precompute(in_size: usize, in0: f64, in1: f64, out_size: usize) -> Coeffs {
    let scale = (in1 - in0) / out_size as f64;
    let filterscale = scale.max(1.0);
    let support = 2.0 * filterscale;
    let ksize = support.ceil() as usize * 2 + 1;
    let mut pre = vec![0f64; out_size * ksize];
    let mut bounds = Vec::with_capacity(out_size);
    for xx in 0..out_size {
        let center = in0 + (xx as f64 + 0.5) * scale;
        let ss = 1.0 / filterscale;
        let xmin = ((center - support + 0.5) as i64).max(0);
        let xmax = ((center + support + 0.5) as i64).min(in_size as i64);
        let n = (xmax - xmin).max(0) as usize;
        let k = &mut pre[xx * ksize..(xx + 1) * ksize];
        let mut ww = 0.0;
        for (x, kx) in k.iter_mut().enumerate().take(n) {
            let w = bicubic((x as f64 + xmin as f64 - center + 0.5) * ss);
            *kx = w;
            ww += w;
        }
        for kx in k.iter_mut().take(n) {
            if ww != 0.0 {
                *kx /= ww;
            }
        }
        bounds.push((xmin as usize, n));
    }
    let scale_i = (1i64 << PRECISION_BITS) as f64;
    let kk = pre
        .iter()
        .map(|&v| {
            if v < 0.0 {
                (-0.5 + v * scale_i) as i32
            } else {
                (0.5 + v * scale_i) as i32
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

/// Pillow's two-pass resample of an RGB buffer with a float source box.
fn resample_rgb(
    src: &[u8],
    w: usize,
    h: usize,
    bx: (f64, f64, f64, f64),
    ow: usize,
    oh: usize,
) -> Vec<u8> {
    let horiz = precompute(w, bx.0, bx.2, ow);
    let mut vert = precompute(h, bx.1, bx.3, oh);
    let need_h = ow != w || bx.0 != 0.0 || bx.2 != ow as f64;
    let need_v = oh != h || bx.1 != 0.0 || bx.3 != oh as f64;
    let first = vert.bounds[0].0;
    let last = vert.bounds[oh - 1].0 + vert.bounds[oh - 1].1;
    let (mut cur, mut cw) = (src.to_vec(), w);
    if need_h {
        for b in vert.bounds.iter_mut() {
            b.0 -= first;
        }
        let th = last - first;
        let mut tmp = vec![0u8; ow * th * 3];
        for yy in 0..th {
            for xx in 0..ow {
                let (xmin, n) = horiz.bounds[xx];
                let k = &horiz.kk[xx * horiz.ksize..];
                for c in 0..3 {
                    let mut ss: i64 = 1 << (PRECISION_BITS - 1);
                    for x in 0..n {
                        ss += src[((yy + first) * w + x + xmin) * 3 + c] as i64 * k[x] as i64;
                    }
                    tmp[(yy * ow + xx) * 3 + c] = clip8(ss);
                }
            }
        }
        cur = tmp;
        cw = ow;
    }
    if need_v {
        let mut out = vec![0u8; cw * oh * 3];
        for yy in 0..oh {
            let (ymin, n) = vert.bounds[yy];
            let k = &vert.kk[yy * vert.ksize..];
            for xx in 0..cw {
                for c in 0..3 {
                    let mut ss: i64 = 1 << (PRECISION_BITS - 1);
                    for y in 0..n {
                        ss += cur[((y + ymin) * cw + xx) * 3 + c] as i64 * k[y] as i64;
                    }
                    out[(yy * cw + xx) * 3 + c] = clip8(ss);
                }
            }
        }
        cur = out;
    }
    cur
}

/// Pillow `Image.reduce(factor)`: box average with rounding.
fn reduce_rgb(src: &[u8], w: usize, h: usize, fx: usize, fy: usize) -> (Vec<u8>, usize, usize) {
    let ow = w.div_ceil(fx);
    let oh = h.div_ceil(fy);
    let mut out = vec![0u8; ow * oh * 3];
    for oy in 0..oh {
        for ox in 0..ow {
            let (x0, y0) = (ox * fx, oy * fy);
            let (x1, y1) = ((x0 + fx).min(w), (y0 + fy).min(h));
            let n = ((x1 - x0) * (y1 - y0)) as u32;
            for c in 0..3 {
                let mut s = 0u32;
                for y in y0..y1 {
                    for x in x0..x1 {
                        s += src[(y * w + x) * 3 + c] as u32;
                    }
                }
                out[(oy * ow + ox) * 3 + c] = ((s + n / 2) / n) as u8;
            }
        }
    }
    (out, ow, oh)
}

/// `Image.thumbnail((100, 100))` target size (Pillow's `preserve_aspect_ratio`).
fn thumbnail_size(w: usize, h: usize, bx: usize, by: usize) -> Option<(usize, usize)> {
    if bx >= w && by >= h {
        return None;
    }
    let aspect = w as f64 / h as f64;
    let (x, y) = (bx as f64, by as f64);
    let round_aspect = |number: f64, key: &dyn Fn(f64) -> f64| -> usize {
        let (f, c) = (number.floor(), number.ceil());
        let best = if key(c) < key(f) { c } else { f };
        (best as usize).max(1)
    };
    if x / y >= aspect {
        let nx = round_aspect(y * aspect, &|n| (aspect - n / y).abs());
        Some((nx, by))
    } else {
        let ny = round_aspect(x / aspect, &|n| {
            if n == 0.0 {
                0.0
            } else {
                (aspect - x / n).abs()
            }
        });
        Some((bx, ny))
    }
}

/// A median-cut box: colours (with pixel counts) and its tree position.
struct CBox {
    colors: Vec<([u8; 3], u32)>,
    count: u64,
    /// Path from the root (false = left), for Pillow's leaf numbering.
    path: Vec<bool>,
    seq: usize,
}

fn volume(colors: &[([u8; 3], u32)]) -> u64 {
    (0..3)
        .map(|a| {
            let lo = colors.iter().map(|(c, _)| c[a]).min().unwrap_or(0) as u64;
            let hi = colors.iter().map(|(c, _)| c[a]).max().unwrap_or(0) as u64;
            hi - lo + 1
        })
        .product()
}

/// Pillow `Quant.c` `median_cut` + `split` + `splitlists`: repeatedly split
/// the box holding the most pixels along its widest luma-weighted axis, at
/// the pixel median (all entries equal to the median value stay left).
fn median_cut(hist: Vec<([u8; 3], u32)>, n: usize) -> Vec<CBox> {
    let total: u64 = hist.iter().map(|(_, c)| *c as u64).sum();
    let mut seq = 0usize;
    let mut heap: Vec<CBox> = vec![CBox {
        colors: hist,
        count: total,
        path: Vec::new(),
        seq,
    }];
    let mut leaves: Vec<CBox> = Vec::new();
    let mut remaining = n;
    while remaining > 1 {
        remaining -= 1;
        let node = loop {
            if heap.is_empty() {
                break None;
            }
            let (i, _) = heap
                .iter()
                .enumerate()
                .max_by(|(_, a), (_, b)| a.count.cmp(&b.count).then(b.seq.cmp(&a.seq)))
                .expect("non-empty");
            let b = heap.swap_remove(i);
            if volume(&b.colors) == 1 {
                leaves.push(b);
                continue;
            }
            break Some(b);
        };
        let Some(mut b) = node else { break };
        let range = |a: usize| {
            let lo = b.colors.iter().map(|(c, _)| c[a]).min().unwrap_or(0) as i64;
            let hi = b.colors.iter().map(|(c, _)| c[a]).max().unwrap_or(0) as i64;
            hi - lo
        };
        let f = [range(0) * 77, range(1) * 150, range(2) * 29];
        let mut axis = 0;
        for i in 1..3 {
            if f[i] > f[axis] {
                axis = i;
            }
        }
        b.colors.sort_by(|x, y| y.0[axis].cmp(&x.0[axis]));
        let mut left = 0u64;
        let mut cut = b.colors.len();
        for (i, (_, cnt)) in b.colors.iter().enumerate() {
            left += *cnt as u64;
            if left * 2 > b.count {
                cut = i + 1;
                break;
            }
        }
        if cut < b.colors.len() {
            let v = b.colors[cut - 1].0[axis];
            while cut < b.colors.len() && b.colors[cut].0[axis] == v {
                cut += 1;
            }
        }
        if cut == b.colors.len() {
            let v = b.colors[cut - 1].0[axis];
            while cut > 0 && b.colors[cut - 1].0[axis] == v {
                cut -= 1;
            }
        }
        let right = b.colors.split_off(cut);
        let lc: u64 = b.colors.iter().map(|(_, c)| *c as u64).sum();
        let rc: u64 = right.iter().map(|(_, c)| *c as u64).sum();
        let mut lp = b.path.clone();
        lp.push(false);
        let mut rp = b.path;
        rp.push(true);
        seq += 1;
        heap.push(CBox {
            colors: b.colors,
            count: lc,
            path: lp,
            seq,
        });
        seq += 1;
        heap.push(CBox {
            colors: right,
            count: rc,
            path: rp,
            seq,
        });
    }
    leaves.extend(heap);
    leaves.retain(|b| !b.colors.is_empty());
    leaves.sort_by(|a, b| a.path.cmp(&b.path));
    leaves
}

/// Dominant colour of RGB pixels.
pub fn dominant_rgb(rgb: &[u8], w: usize, h: usize) -> Option<[u8; 3]> {
    if w == 0 || h == 0 {
        return None;
    }
    let (mut px, mut pw, mut ph) = (rgb.to_vec(), w, h);
    if let Some((tw, th)) = thumbnail_size(w, h, 100, 100) {
        let gap = 2.0;
        let fx = ((w as f64 / tw as f64 / gap) as usize).max(1);
        let fy = ((h as f64 / th as f64 / gap) as usize).max(1);
        let mut bx = (0.0, 0.0, w as f64, h as f64);
        if fx > 1 || fy > 1 {
            let (r, rw, rh) = reduce_rgb(&px, pw, ph, fx, fy);
            bx = (0.0, 0.0, w as f64 / fx as f64, h as f64 / fy as f64);
            px = r;
            pw = rw;
            ph = rh;
        }
        px = resample_rgb(&px, pw, ph, bx, tw, th);
    }
    let mut counts: std::collections::HashMap<[u8; 3], u32> = std::collections::HashMap::new();
    for p in px.chunks_exact(3) {
        *counts.entry([p[0], p[1], p[2]]).or_default() += 1;
    }
    let mut hist: Vec<([u8; 3], u32)> = counts.into_iter().collect();
    hist.sort();
    let boxes = median_cut(hist, 16);
    // compute_palette_from_median_cut: rounded mean per box.
    let mut palette: Vec<[u8; 3]> = Vec::with_capacity(boxes.len());
    let mut box_of: std::collections::HashMap<[u8; 3], usize> = std::collections::HashMap::new();
    for (i, b) in boxes.iter().enumerate() {
        let mut sum = [0f64; 3];
        for (c, n) in &b.colors {
            for a in 0..3 {
                sum[a] += c[a] as f64 * *n as f64;
            }
            box_of.insert(*c, i);
        }
        let n = b.count.max(1) as f64;
        palette.push([
            (0.5 + sum[0] / n) as u8,
            (0.5 + sum[1] / n) as u8,
            (0.5 + sum[2] / n) as u8,
        ]);
    }
    // map_image_pixels_from_median_box: nearest palette entry, own box first.
    let dist = |a: [u8; 3], b: [u8; 3]| -> i64 {
        (0..3).map(|k| (a[k] as i64 - b[k] as i64).pow(2)).sum()
    };
    let mut hits = vec![0u64; palette.len()];
    for b in &boxes {
        for (c, n) in &b.colors {
            let own = box_of[c];
            let mut best = own;
            let mut bd = dist(palette[own], *c);
            for (j, p) in palette.iter().enumerate() {
                let d = dist(*p, *c);
                if d < bd {
                    bd = d;
                    best = j;
                }
            }
            hits[best] += *n as u64;
        }
    }
    let (idx, _) = hits
        .iter()
        .enumerate()
        .max_by(|(ia, a), (ib, b)| a.cmp(b).then(ia.cmp(ib)))?;
    Some(palette[idx])
}

/// Dominant colour of a WebP file (None for anything else, e.g. an mp4).
pub fn dominant_webp_file(path: &Path) -> Option<[u8; 3]> {
    let data = std::fs::read(path).ok()?;
    let img = webp::Decoder::new(&data).decode()?;
    let (w, h) = (img.width() as usize, img.height() as usize);
    let rgb: Vec<u8> = if img.is_alpha() {
        img.chunks_exact(4)
            .flat_map(|p| [p[0], p[1], p[2]])
            .collect()
    } else {
        img.to_vec()
    };
    dominant_rgb(&rgb, w, h)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thumbnail_box_like_pillow() {
        assert_eq!(thumbnail_size(333, 250, 100, 100), Some((100, 75)));
        assert_eq!(thumbnail_size(141, 250, 100, 100), Some((56, 100)));
        assert_eq!(thumbnail_size(80, 60, 100, 100), None);
    }

    #[test]
    fn solid_colour() {
        let px: Vec<u8> = std::iter::repeat_n([10u8, 20, 30], 200 * 150)
            .flatten()
            .collect();
        assert_eq!(dominant_rgb(&px, 200, 150), Some([10, 20, 30]));
    }
}
