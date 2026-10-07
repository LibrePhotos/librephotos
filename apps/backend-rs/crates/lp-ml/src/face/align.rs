//! insightface `face_align.norm_crop`: a similarity transform from the five
//! detected landmarks onto `arcface_dst` (skimage's Umeyama estimate), then
//! `cv2.warpAffine(img, M, (size, size), borderValue=0)` with OpenCV 5's
//! float bilinear kernel.

/// `arcface_dst` (float32 literals).
#[allow(clippy::excessive_precision)]
pub const ARCFACE_DST: [[f32; 2]; 5] = [
    [38.2946, 51.6963],
    [73.5318, 51.5014],
    [56.0252, 71.7366],
    [41.5493, 92.3655],
    [70.7299, 92.2041],
];

/// `estimate_norm(lmk, image_size)`: the 2x3 matrix mapping image points to
/// the aligned crop, `None` when the landmarks are degenerate (skimage
/// returns NaNs there).
///
/// For 2-D points the Umeyama rotation maximises `tr(R^T A)`, which is the
/// angle `atan2(A10 - A01, A00 + A11)`, and `S @ d` equals the norm of that
/// vector; skimage gets both from an SVD in float32, so the matrix agrees to
/// ~1e-7 relative, below what the float32 warp resolves.
pub fn estimate_norm(lmk: &[[f32; 2]; 5], image_size: usize) -> Option<[f64; 6]> {
    let (ratio, diff_x) = if image_size.is_multiple_of(112) {
        (image_size as f32 / 112.0, 0.0f32)
    } else {
        let r = image_size as f32 / 128.0;
        (r, 8.0 * r)
    };
    let dst: Vec<[f64; 2]> = ARCFACE_DST
        .iter()
        .map(|p| [(p[0] * ratio + diff_x) as f64, (p[1] * ratio) as f64])
        .collect();
    let src: Vec<[f64; 2]> = lmk.iter().map(|p| [p[0] as f64, p[1] as f64]).collect();
    let n = src.len() as f64;
    let mean = |pts: &[[f64; 2]]| {
        let (sx, sy) = pts
            .iter()
            .fold((0.0, 0.0), |(x, y), p| (x + p[0], y + p[1]));
        [sx / n, sy / n]
    };
    let sm = mean(&src);
    let dm = mean(&dst);
    let (mut a00, mut a01, mut a10, mut a11, mut var) = (0.0, 0.0, 0.0, 0.0, 0.0);
    for (s, d) in src.iter().zip(&dst) {
        let (sx, sy) = (s[0] - sm[0], s[1] - sm[1]);
        let (dx, dy) = (d[0] - dm[0], d[1] - dm[1]);
        a00 += dx * sx;
        a01 += dx * sy;
        a10 += dy * sx;
        a11 += dy * sy;
        var += sx * sx + sy * sy;
    }
    let (p, q) = ((a00 + a11) / n, (a10 - a01) / n);
    let norm = p.hypot(q);
    var /= n;
    let well_posed = norm > 0.0 && var > 0.0 && norm.is_finite();
    if !well_posed {
        return None;
    }
    let scale = norm / var;
    let (c, s) = (p / norm, q / norm);
    let (m00, m01, m10, m11) = (scale * c, -scale * s, scale * s, scale * c);
    let tx = dm[0] - (m00 * sm[0] + m01 * sm[1]);
    let ty = dm[1] - (m10 * sm[0] + m11 * sm[1]);
    Some([m00, m01, tx, m10, m11, ty])
}

/// `cv2.warpAffine(src, M, (size, size), flags=INTER_LINEAR,
/// borderMode=BORDER_CONSTANT, borderValue=0)` for an 8-bit, 3-channel image,
/// as OpenCV 5 computes it: M inverted in double, cast to float; per row
/// `y*M1 + M2` in float, per pixel `fma(M0, x, row)`; taps outside the image
/// read 0; `fma` lerps along x then y; round half to even.
pub fn warp_affine(src: &[u8], w: usize, h: usize, m: &[f64; 6], size: usize) -> Vec<u8> {
    assert_eq!(src.len(), w * h * 3, "RGB buffer size");
    let mut mi = *m;
    let d = mi[0] * mi[4] - mi[1] * mi[3];
    let d = if d != 0.0 { 1.0 / d } else { 0.0 };
    let (a11, a22) = (mi[4] * d, mi[0] * d);
    mi[0] = a11;
    mi[1] *= -d;
    mi[3] *= -d;
    mi[4] = a22;
    let b1 = -mi[0] * mi[2] - mi[1] * mi[5];
    let b2 = -mi[3] * mi[2] - mi[4] * mi[5];
    mi[2] = b1;
    mi[5] = b2;
    let mf = mi.map(|v| v as f32);

    let px = |x: i64, y: i64, c: usize| -> f32 {
        if x >= 0 && y >= 0 && (x as usize) < w && (y as usize) < h {
            src[(y as usize * w + x as usize) * 3 + c] as f32
        } else {
            0.0
        }
    };
    let mut out = vec![0u8; size * size * 3];
    for y in 0..size {
        let yf = y as f32;
        let row_x = yf * mf[1] + mf[2];
        let row_y = yf * mf[4] + mf[5];
        for x in 0..size {
            let xf = x as f32;
            let sx = mf[0].mul_add(xf, row_x);
            let sy = mf[3].mul_add(xf, row_y);
            let fx = sx.floor();
            let fy = sy.floor();
            let (ix, iy) = (fx as i64, fy as i64);
            let (ax, ay) = (sx - fx, sy - fy);
            for c in 0..3 {
                let p00 = px(ix, iy, c);
                let p01 = px(ix + 1, iy, c);
                let p10 = px(ix, iy + 1, c);
                let p11 = px(ix + 1, iy + 1, c);
                let v0 = ax.mul_add(p01 - p00, p00);
                let v1 = ax.mul_add(p11 - p10, p10);
                let v = ay.mul_add(v1 - v0, v0);
                out[(y * size + x) * 3 + c] = v.round_ties_even().clamp(0.0, 255.0) as u8;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_landmarks_give_identity() {
        let m = estimate_norm(&ARCFACE_DST, 112).unwrap();
        let want = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
        for (a, b) in m.iter().zip(want) {
            assert!((a - b).abs() < 1e-5, "{m:?}");
        }
    }

    #[test]
    fn identity_warp_copies() {
        let src: Vec<u8> = (0..8 * 8 * 3).map(|i| i as u8).collect();
        let out = warp_affine(&src, 8, 8, &[1.0, 0.0, 0.0, 0.0, 1.0, 0.0], 8);
        assert_eq!(out, src);
    }

    #[test]
    fn degenerate_landmarks() {
        assert!(estimate_norm(&[[3.0, 3.0]; 5], 112).is_none());
    }
}
