//! LibRaw's default demosaic (`user_qual` -1 = AHD, Hirakawa's adaptive
//! homogeneity-directed interpolation) for 2x2 Bayer sensors, integer for
//! integer: `border_interpolate(5)`, then per 512-pixel tile the horizontal
//! and vertical green estimates, red/blue and CIELab for both, the
//! homogeneity maps and the per-pixel pick.
//!
//! A pixel only ever reads the raw samples of its neighbours (their own
//! colour), which the result keeps unchanged, so tiles are independent.

// Index loops mirror LibRaw's C, which keeps the port checkable line by line.
#![allow(clippy::needless_range_loop)]

use rayon::prelude::*;

const TS: usize = 512;
/// A tile's combined rows.
type Rows = Vec<Vec<[u16; 3]>>;
const XYZ_RGB: [[f64; 3]; 3] = [
    [0.412453, 0.357580, 0.180423],
    [0.212671, 0.715160, 0.072169],
    [0.019334, 0.119193, 0.950227],
];
const D65_WHITE: [f32; 3] = [0.950456, 1.0, 1.088754];

/// Demosaic `img` in place: `img[i][fc(row, col)]` holds each raw sample
/// (already scaled), the other channels are filled.
pub fn ahd<F>(img: &mut [[u16; 3]], w: usize, h: usize, fc: &F, rgb_cam: &[[f32; 4]; 3])
where
    F: Fn(usize, usize) -> usize + Sync,
{
    border_interpolate(img, w, h, 5, fc);
    if w < 8 || h < 8 {
        return;
    }
    let lab = CieLab::new(rgb_cam);
    let src: &[[u16; 3]] = img;
    let mut tiles = Vec::new();
    let mut top = 2;
    while top < h - 5 {
        let mut left = 2;
        while left < w - 5 {
            tiles.push((top, left));
            left += TS - 6;
        }
        top += TS - 6;
    }
    let results: Vec<(usize, usize, Rows)> = tiles
        .par_iter()
        .map(|&(top, left)| (top, left, tile(src, w, h, top, left, fc, &lab)))
        .collect();
    for (top, left, rows) in results {
        for (i, row) in rows.into_iter().enumerate() {
            let start = (top + 3 + i) * w + left + 3;
            img[start..start + row.len()].copy_from_slice(&row);
        }
    }
}

/// dcraw `border_interpolate`: within `border` pixels of an edge, each
/// missing colour is the mean of that colour in the 3x3 neighbourhood.
pub fn border_interpolate<F>(img: &mut [[u16; 3]], w: usize, h: usize, border: usize, fc: &F)
where
    F: Fn(usize, usize) -> usize + Sync,
{
    for row in 0..h {
        let mut col = 0;
        while col < w {
            if col == border && row >= border && row + border < h {
                col = w - border;
                if col < border {
                    break;
                }
            }
            let mut sum = [0u32; 3];
            let mut n = [0u32; 3];
            for y in row.saturating_sub(1)..(row + 2).min(h) {
                for x in col.saturating_sub(1)..(col + 2).min(w) {
                    let f = fc(y, x);
                    sum[f] += img[y * w + x][f] as u32;
                    n[f] += 1;
                }
            }
            let f = fc(row, col);
            for c in 0..3 {
                if c != f && n[c] > 0 {
                    img[row * w + col][c] = (sum[c] / n[c]) as u16;
                }
            }
            col += 1;
        }
    }
}

struct CieLab {
    cbrt: Vec<f32>,
    xyz_cam: [[f32; 3]; 3],
}

impl CieLab {
    fn new(rgb_cam: &[[f32; 4]; 3]) -> CieLab {
        let cbrt = (0..0x10000)
            .map(|i| {
                let r = (i as f64 / 65535.0) as f32;
                if r as f64 > 0.008856 {
                    r.powf(1.0 / 3.0)
                } else {
                    7.787 * r + 16.0 / 116.0
                }
            })
            .collect();
        let mut xyz_cam = [[0f32; 3]; 3];
        for i in 0..3 {
            for j in 0..3 {
                let mut v = 0f32;
                for k in 0..3 {
                    v += (XYZ_RGB[i][k] * rgb_cam[k][j] as f64 / D65_WHITE[i] as f64) as f32;
                }
                xyz_cam[i][j] = v;
            }
        }
        CieLab { cbrt, xyz_cam }
    }

    fn lab(&self, rgb: [u16; 3]) -> [i16; 3] {
        let mut xyz = [0.5f32; 3];
        for (k, x) in xyz.iter_mut().enumerate() {
            for c in 0..3 {
                *x += self.xyz_cam[k][c] * rgb[c] as f32;
            }
        }
        let xyz = xyz.map(|v| self.cbrt[(v as i32).clamp(0, 65535) as usize]);
        [
            (64.0 * (116.0 * xyz[1] - 16.0)) as i32 as i16,
            (64.0 * 500.0 * (xyz[0] - xyz[1])) as i32 as i16,
            (64.0 * 200.0 * (xyz[1] - xyz[2])) as i32 as i16,
        ]
    }
}

fn clip(v: i32) -> u16 {
    v.clamp(0, 65535) as u16
}

/// `ULIM(x, y, z)`: `x` limited to the range spanned by `y` and `z`.
fn ulim(x: i32, y: i32, z: i32) -> i32 {
    if y < z { x.clamp(y, z) } else { x.clamp(z, y) }
}

/// One tile; returns the combined rows `top+3..`, each from column `left+3`.
fn tile<F>(
    src: &[[u16; 3]],
    w: usize,
    h: usize,
    top: usize,
    left: usize,
    fc: &F,
    cl: &CieLab,
) -> Rows
where
    F: Fn(usize, usize) -> usize + Sync,
{
    let mut rgb = vec![[0u16; 3]; 2 * TS * TS];
    let mut lab = vec![[0i16; 3]; 2 * TS * TS];
    let mut homo = vec![0u8; 2 * TS * TS];
    let at = |row: usize, col: usize| -> usize { row * w + col };
    let t = |d: usize, tr: usize, tc: usize| -> usize { d * TS * TS + tr * TS + tc };
    let s = |i: usize, c: usize| -> i32 { src[i][c] as i32 };

    // Green, horizontally (d = 0) and vertically (d = 1).
    for row in top..(top + TS).min(h - 2) {
        let mut col = left + (fc(row, left) & 1);
        let c = fc(row, col);
        while col < left + TS && col < w - 2 {
            let p = at(row, col);
            let val = ((s(p - 1, 1) + s(p, c) + s(p + 1, 1)) * 2 - s(p - 2, c) - s(p + 2, c)) >> 2;
            rgb[t(0, row - top, col - left)][1] = ulim(val, s(p - 1, 1), s(p + 1, 1)) as u16;
            let val =
                ((s(p - w, 1) + s(p, c) + s(p + w, 1)) * 2 - s(p - 2 * w, c) - s(p + 2 * w, c))
                    >> 2;
            rgb[t(1, row - top, col - left)][1] = ulim(val, s(p - w, 1), s(p + w, 1)) as u16;
            col += 2;
        }
    }

    // Red and blue, and CIELab.
    for d in 0..2 {
        for row in top + 1..(top + TS - 1).min(h - 3) {
            for col in left + 1..(left + TS - 1).min(w - 3) {
                let p = at(row, col);
                let r = t(d, row - top, col - left);
                macro_rules! g {
                    ($i:expr) => {
                        rgb[$i][1] as i32
                    };
                }
                let mut c = 2 - fc(row, col);
                let val;
                if c == 1 {
                    c = fc(row + 1, col);
                    let v = s(p, 1)
                        + ((s(p - 1, 2 - c) + s(p + 1, 2 - c) - g!(r - 1) - g!(r + 1)) >> 1);
                    rgb[r][2 - c] = clip(v);
                    val = s(p, 1) + ((s(p - w, c) + s(p + w, c) - g!(r - TS) - g!(r + TS)) >> 1);
                } else {
                    val = g!(r)
                        + ((s(p - w - 1, c) + s(p - w + 1, c) + s(p + w - 1, c) + s(p + w + 1, c)
                            - g!(r - TS - 1)
                            - g!(r - TS + 1)
                            - g!(r + TS - 1)
                            - g!(r + TS + 1)
                            + 1)
                            >> 2);
                }
                rgb[r][c] = clip(val);
                let own = fc(row, col);
                rgb[r][own] = src[p][own];
                lab[r] = cl.lab(rgb[r]);
            }
        }
    }

    // Homogeneity maps.
    let dirs: [isize; 4] = [-1, 1, -(TS as isize), TS as isize];
    for row in top + 2..(top + TS - 2).min(h - 4) {
        let tr = row - top;
        for col in left + 2..(left + TS - 2).min(w - 4) {
            let tc = col - left;
            let mut ldiff = [[0u32; 4]; 2];
            let mut abdiff = [[0u32; 4]; 2];
            for d in 0..2 {
                let i0 = t(d, tr, tc);
                let l0 = lab[i0];
                for (i, dir) in dirs.iter().enumerate() {
                    let l1 = lab[(i0 as isize + dir) as usize];
                    ldiff[d][i] = (l0[0] as i32 - l1[0] as i32).unsigned_abs();
                    let (da, db) = (l0[1] as i32 - l1[1] as i32, l0[2] as i32 - l1[2] as i32);
                    abdiff[d][i] = (da * da + db * db) as u32;
                }
            }
            let leps = ldiff[0][0]
                .max(ldiff[0][1])
                .min(ldiff[1][2].max(ldiff[1][3]));
            let abeps = abdiff[0][0]
                .max(abdiff[0][1])
                .min(abdiff[1][2].max(abdiff[1][3]));
            for d in 0..2 {
                homo[t(d, tr, tc)] = (0..4)
                    .filter(|&i| ldiff[d][i] <= leps && abdiff[d][i] <= abeps)
                    .count() as u8;
            }
        }
    }

    // The more homogeneous direction per pixel (both averaged on a tie).
    let mut out = Vec::new();
    for row in top + 3..(top + TS - 3).min(h - 5) {
        let tr = row - top;
        let mut line = Vec::new();
        for col in left + 3..(left + TS - 3).min(w - 5) {
            let tc = col - left;
            let mut hm = [0u32; 2];
            for (d, v) in hm.iter_mut().enumerate() {
                for i in tr - 1..=tr + 1 {
                    for j in tc - 1..=tc + 1 {
                        *v += homo[t(d, i, j)] as u32;
                    }
                }
            }
            let (a, b) = (rgb[t(0, tr, tc)], rgb[t(1, tr, tc)]);
            line.push(if hm[0] != hm[1] {
                if hm[1] > hm[0] { b } else { a }
            } else {
                [0, 1, 2].map(|c| ((a[c] as u32 + b[c] as u32) >> 1) as u16)
            });
        }
        out.push(line);
    }
    out
}
