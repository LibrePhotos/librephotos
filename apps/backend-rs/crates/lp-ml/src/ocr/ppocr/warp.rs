//! `get_rotate_crop_image`: `cv2.getPerspectiveTransform` (8x8 LU solve)
//! and `cv2.warpPerspective(INTER_CUBIC, BORDER_REPLICATE)` as OpenCV 5
//! runs it (the table-free bicubic kernel: f32 weights with A = -0.75, FMA
//! accumulation, round half to even), then a 90 degree turn for tall crops.

/// A crop taller than wide by this ratio is turned upright.
pub const ROTATE_ASPECT_THRESHOLD: f64 = 1.5;

/// An interleaved 3-channel u8 image.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Image3 {
    pub w: usize,
    pub h: usize,
    pub data: Vec<u8>,
}

/// `getPerspectiveTransform(src, dst)` with `DECOMP_LU`; `None` when the
/// system is singular (OpenCV then falls back to an SVD, which never
/// happens for a detected box).
pub fn perspective_transform(src: &[[f32; 2]; 4], dst: &[[f32; 2]; 4]) -> Option<[f64; 9]> {
    let mut a = [[0f64; 8]; 8];
    let mut b = [0f64; 8];
    for i in 0..4 {
        a[i][0] = src[i][0] as f64;
        a[i + 4][3] = src[i][0] as f64;
        a[i][1] = src[i][1] as f64;
        a[i + 4][4] = src[i][1] as f64;
        a[i][2] = 1.0;
        a[i + 4][5] = 1.0;
        a[i][6] = (-src[i][0] * dst[i][0]) as f64;
        a[i][7] = (-src[i][1] * dst[i][0]) as f64;
        a[i + 4][6] = (-src[i][0] * dst[i][1]) as f64;
        a[i + 4][7] = (-src[i][1] * dst[i][1]) as f64;
        b[i] = dst[i][0] as f64;
        b[i + 4] = dst[i][1] as f64;
    }
    let x = lu_solve(a, b)?;
    let mut m = [0f64; 9];
    m[..8].copy_from_slice(&x);
    m[8] = 1.0;
    Some(m)
}

/// OpenCV's `LUImpl` (partial pivoting, eps = 100 * DBL_EPSILON).
fn lu_solve(mut a: [[f64; 8]; 8], mut b: [f64; 8]) -> Option<[f64; 8]> {
    const M: usize = 8;
    let eps = f64::EPSILON * 100.0;
    for i in 0..M {
        let mut k = i;
        for j in i + 1..M {
            if a[j][i].abs() > a[k][i].abs() {
                k = j;
            }
        }
        if a[k][i].abs() < eps {
            return None;
        }
        if k != i {
            a.swap(i, k);
            b.swap(i, k);
        }
        let d = -1.0 / a[i][i];
        let pivot = a[i];
        for j in i + 1..M {
            let alpha = a[j][i] * d;
            for (x, p) in a[j][i + 1..].iter_mut().zip(&pivot[i + 1..]) {
                *x += alpha * p;
            }
            b[j] += alpha * b[i];
        }
    }
    for i in (0..M).rev() {
        let mut s = b[i];
        for k in i + 1..M {
            s -= a[i][k] * b[k];
        }
        b[i] = s / a[i][i];
    }
    Some(b)
}

/// `cv::invert` of a 3x3 f64 matrix (the closed form `DECOMP_LU` uses).
fn invert3(m: &[f64; 9]) -> Option<[f64; 9]> {
    let s = |r: usize, c: usize| m[r * 3 + c];
    let d = s(0, 0) * (s(1, 1) * s(2, 2) - s(1, 2) * s(2, 1))
        - s(0, 1) * (s(1, 0) * s(2, 2) - s(1, 2) * s(2, 0))
        + s(0, 2) * (s(1, 0) * s(2, 1) - s(1, 1) * s(2, 0));
    if d == 0.0 {
        return None;
    }
    let d = 1.0 / d;
    Some([
        (s(1, 1) * s(2, 2) - s(1, 2) * s(2, 1)) * d,
        (s(0, 2) * s(2, 1) - s(0, 1) * s(2, 2)) * d,
        (s(0, 1) * s(1, 2) - s(0, 2) * s(1, 1)) * d,
        (s(1, 2) * s(2, 0) - s(1, 0) * s(2, 2)) * d,
        (s(0, 0) * s(2, 2) - s(0, 2) * s(2, 0)) * d,
        (s(0, 2) * s(1, 0) - s(0, 0) * s(1, 2)) * d,
        (s(1, 0) * s(2, 1) - s(1, 1) * s(2, 0)) * d,
        (s(0, 1) * s(2, 0) - s(0, 0) * s(2, 1)) * d,
        (s(0, 0) * s(1, 1) - s(0, 1) * s(1, 0)) * d,
    ])
}

/// `bicubicWeights` (vector form: `w1` with two FMAs).
#[inline(always)]
fn weights(alpha: f32) -> [f32; 4] {
    const A: f32 = -0.75;
    let a2 = alpha * alpha;
    let b = 1.0 - alpha;
    let b2 = b * b;
    let w0 = A * (alpha * b2);
    let w3 = A * (a2 * b);
    let w1 = a2.mul_add((A + 2.0).mul_add(alpha, -(A + 3.0)), 1.0);
    let w2 = ((1.0 - w0) - w1) - w3;
    [w0, w1, w2, w3]
}

/// `borderInterpolate(p, len, BORDER_REPLICATE)`.
#[inline(always)]
fn replicate(p: i32, len: usize) -> usize {
    p.clamp(0, len as i32 - 1) as usize
}

/// `cv2.warpPerspective(img, M, (dw, dh), flags=INTER_CUBIC,
/// borderMode=BORDER_REPLICATE)` where `m` maps source to destination.
pub fn warp_perspective_cubic(src: &Image3, m: &[f64; 9], dw: usize, dh: usize) -> Image3 {
    let mut out = vec![0u8; dw * dh * 3];
    let Some(inv) = invert3(m) else {
        return Image3 {
            w: dw,
            h: dh,
            data: out,
        };
    };
    // genericWarp converts the (inverse) matrix to f32.
    let mf: [f32; 9] = inv.map(|v| v as f32);
    // `mul_add` is a libm call unless the FMA instructions are enabled.
    #[cfg(target_arch = "x86_64")]
    if std::arch::is_x86_feature_detected!("fma") {
        // SAFETY: the CPU supports FMA (checked just above).
        unsafe { warp_rows_fma(src, &mf, dw, dh, &mut out) };
        return Image3 {
            w: dw,
            h: dh,
            data: out,
        };
    }
    warp_rows(src, &mf, dw, dh, &mut out);
    Image3 {
        w: dw,
        h: dh,
        data: out,
    }
}

#[cfg(target_arch = "x86_64")]
#[target_feature(enable = "fma")]
unsafe fn warp_rows_fma(src: &Image3, mf: &[f32; 9], dw: usize, dh: usize, out: &mut [u8]) {
    warp_rows(src, mf, dw, dh, out);
}

#[inline(always)]
fn warp_rows(src: &Image3, mf: &[f32; 9], dw: usize, dh: usize, out: &mut [u8]) {
    let (sw, sh) = (src.w, src.h);
    let bigw = sw.max(16) as f32;
    let bigh = sh.max(16) as f32;
    for y in 0..dh {
        let fy = y as f32;
        let m_x = fy * mf[1] + mf[2];
        let m_y = fy * mf[4] + mf[5];
        let m_z = fy * mf[7] + mf[8];
        for x in 0..dw {
            let xf = x as f64;
            let invz = 1.0 / (m_z as f64 + mf[6] as f64 * xf);
            let xs = ((m_x as f64 + mf[0] as f64 * xf) * invz) as f32;
            let ys = ((m_y as f64 + mf[3] as f64 * xf) * invz) as f32;
            let vx = xs.clamp(-bigw, bigw * 2.0);
            let vy = ys.clamp(-bigh, bigh * 2.0);
            let ix = vx.floor() as i32;
            let iy = vy.floor() as i32;
            let wx = weights(vx - ix as f32);
            let wy = weights(vy - iy as f32);
            let (ix, iy) = (ix - 1, iy - 1);
            let xs4 = [0, 1, 2, 3].map(|i| replicate(ix + i, sw));
            let mut acc = [0f32; 3];
            for (r, &wyr) in wy.iter().enumerate() {
                let row = replicate(iy + r as i32, sh) * sw;
                for (c, a) in acc.iter_mut().enumerate() {
                    let v = |i: usize| src.data[(row + xs4[i]) * 3 + c] as f32;
                    let mut s = v(1).mul_add(wx[1], v(0) * wx[0]);
                    s = v(2).mul_add(wx[2], s);
                    s = v(3).mul_add(wx[3], s);
                    *a = s.mul_add(wyr, *a);
                }
            }
            let o = (y * dw + x) * 3;
            for c in 0..3 {
                out[o + c] = acc[c].round_ties_even().clamp(0.0, 255.0) as u8;
            }
        }
    }
}

/// `np.rot90`: 90 degrees counter-clockwise.
pub fn rot90(img: &Image3) -> Image3 {
    let (w, h) = (img.w, img.h);
    let mut data = vec![0u8; w * h * 3];
    // out[i][j] = in[j][w - 1 - i], out is w rows x h cols
    for i in 0..w {
        for j in 0..h {
            let s = (j * w + (w - 1 - i)) * 3;
            let d = (i * h + j) * 3;
            data[d..d + 3].copy_from_slice(&img.data[s..s + 3]);
        }
    }
    Image3 { w: h, h: w, data }
}

/// PaddleOCR's `get_rotate_crop_image` for a clockwise TL, TR, BR, BL quad.
pub fn rotate_crop(img: &Image3, quad: &[[i32; 2]; 4]) -> Image3 {
    let p = quad.map(|q| [q[0] as f32, q[1] as f32]);
    let dist = |a: [f32; 2], b: [f32; 2]| {
        let (dx, dy) = (a[0] - b[0], a[1] - b[1]);
        (dx * dx + dy * dy).sqrt()
    };
    let cw = (dist(p[0], p[1]).max(dist(p[2], p[3])) as i64).max(1) as usize;
    let ch = (dist(p[0], p[3]).max(dist(p[1], p[2])) as i64).max(1) as usize;
    let dst = [
        [0.0, 0.0],
        [cw as f32, 0.0],
        [cw as f32, ch as f32],
        [0.0, ch as f32],
    ];
    let crop = match perspective_transform(&p, &dst) {
        Some(m) => warp_perspective_cubic(img, &m, cw, ch),
        None => Image3 {
            w: cw,
            h: ch,
            data: vec![0; cw * ch * 3],
        },
    };
    if crop.w > 0 && crop.h as f64 / crop.w as f64 >= ROTATE_ASPECT_THRESHOLD {
        rot90(&crop)
    } else {
        crop
    }
}
