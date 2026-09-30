//! OpenCV's 8-bit `cv2.resize` (no antialiasing), as PP-OCR and insightface
//! call it. `INTER_LINEAR` follows `imgproc/src/resize.cpp`: 11-bit
//! fixed-point weights, an int horizontal pass, and the vectorised vertical
//! pass's rounding (`((S0 >> 4) * b0 >> 16) + ((S1 >> 4) * b1 >> 16) + 2 >> 2`),
//! which is what x86 (SSE/AVX) and ARM (NEON) builds run for all but the last
//! few pixels of a row. An exact 2x downscale is `INTER_AREA`, as in OpenCV.

/// `cv2.resize(img, (dst_w, dst_h))` with `INTER_LINEAR` (the default).
pub fn resize_linear(
    src: &[u8],
    w: usize,
    h: usize,
    channels: usize,
    dst_w: usize,
    dst_h: usize,
) -> Vec<u8> {
    assert_eq!(src.len(), w * h * channels, "image buffer size");
    if dst_w == w && dst_h == h {
        return src.to_vec();
    }
    if w == dst_w * 2 && h == dst_h * 2 {
        return resize_area(src, w, h, channels, dst_w, dst_h);
    }
    const BITS: i32 = 11;
    const SCALE: f32 = (1 << BITS) as f32;
    // OpenCV divides by the inverse scale it was given.
    let scale_x = 1.0 / (dst_w as f64 / w as f64);
    let scale_y = 1.0 / (dst_h as f64 / h as f64);

    let tab = |dst: usize, src_len: usize, scale: f64| -> Vec<(usize, i32, i32)> {
        (0..dst)
            .map(|d| {
                let f = ((d as f64 + 0.5) * scale - 0.5) as f32;
                let mut s = f.floor() as i64;
                let mut f = f - s as f32;
                if s < 0 {
                    f = 0.0;
                    s = 0;
                }
                if s >= src_len as i64 - 1 {
                    f = 0.0;
                    s = src_len as i64 - 1;
                }
                // saturate_cast<short>(float) = cvRound: half to even.
                let a0 = ((1.0 - f) * SCALE).round_ties_even() as i32;
                let a1 = (f * SCALE).round_ties_even() as i32;
                (s as usize, a0, a1)
            })
            .collect()
    };
    let xt = tab(dst_w, w, scale_x);
    let yt = tab(dst_h, h, scale_y);

    let hrow = |y: usize| -> Vec<i32> {
        let line = &src[y * w * channels..(y + 1) * w * channels];
        let mut out = vec![0i32; dst_w * channels];
        for (dx, &(sx, a0, a1)) in xt.iter().enumerate() {
            let nx = (sx + 1).min(w - 1);
            for c in 0..channels {
                let p0 = line[sx * channels + c] as i32;
                let p1 = line[nx * channels + c] as i32;
                out[dx * channels + c] = p0 * a0 + p1 * a1;
            }
        }
        out
    };

    let mut out = vec![0u8; dst_w * dst_h * channels];
    let mut cache: Option<(usize, Vec<i32>, Vec<i32>)> = None;
    for (dy, &(sy, b0, b1)) in yt.iter().enumerate() {
        let ny = (sy + 1).min(h - 1);
        let (r0, r1) = match &cache {
            Some((y, r0, r1)) if *y == sy => (r0.clone(), r1.clone()),
            _ => (hrow(sy), hrow(ny)),
        };
        let line = &mut out[dy * dst_w * channels..(dy + 1) * dst_w * channels];
        for (i, o) in line.iter_mut().enumerate() {
            let s0 = (r0[i] >> 4).clamp(i16::MIN as i32, i16::MAX as i32);
            let s1 = (r1[i] >> 4).clamp(i16::MIN as i32, i16::MAX as i32);
            let t = ((s0 * b0) >> 16) + ((s1 * b1) >> 16);
            let t = t.clamp(i16::MIN as i32, i16::MAX as i32);
            *o = ((t + 2) >> 2).clamp(0, 255) as u8;
        }
        cache = Some((sy, r0, r1));
    }
    out
}

/// `cv2.resize(..., interpolation=cv2.INTER_AREA)` for downscaling: the
/// pixel-area average (integer factors: OpenCV's fast path, rounding
/// `(sum + n/2) / n`; otherwise the weighted area average, rounded).
pub fn resize_area(
    src: &[u8],
    w: usize,
    h: usize,
    channels: usize,
    dst_w: usize,
    dst_h: usize,
) -> Vec<u8> {
    assert_eq!(src.len(), w * h * channels, "image buffer size");
    if w.is_multiple_of(dst_w) && h.is_multiple_of(dst_h) {
        let (fx, fy) = (w / dst_w, h / dst_h);
        let n = (fx * fy) as u32;
        let mut out = vec![0u8; dst_w * dst_h * channels];
        for dy in 0..dst_h {
            for dx in 0..dst_w {
                for c in 0..channels {
                    let mut sum = 0u32;
                    for y in dy * fy..(dy + 1) * fy {
                        for x in dx * fx..(dx + 1) * fx {
                            sum += src[(y * w + x) * channels + c] as u32;
                        }
                    }
                    out[(dy * dst_w + dx) * channels + c] = ((sum + n / 2) / n) as u8;
                }
            }
        }
        return out;
    }
    // Per-axis (src index, weight) lists; weights of one output sum to 1.
    let tab = |src_len: usize, dst_len: usize| -> Vec<Vec<(usize, f64)>> {
        let scale = src_len as f64 / dst_len as f64;
        (0..dst_len)
            .map(|d| {
                let f0 = d as f64 * scale;
                let f1 = f0 + scale;
                let mut v = Vec::new();
                let mut s = f0.floor() as usize;
                while (s as f64) < f1 && s < src_len {
                    let lo = f0.max(s as f64);
                    let hi = f1.min(s as f64 + 1.0);
                    if hi > lo {
                        v.push((s, (hi - lo) / scale));
                    }
                    s += 1;
                }
                v
            })
            .collect()
    };
    let xt = tab(w, dst_w);
    let yt = tab(h, dst_h);
    let mut out = vec![0u8; dst_w * dst_h * channels];
    for (dy, ys) in yt.iter().enumerate() {
        for (dx, xs) in xt.iter().enumerate() {
            for c in 0..channels {
                let mut sum = 0.0f64;
                for &(y, wy) in ys {
                    for &(x, wx) in xs {
                        sum += src[(y * w + x) * channels + c] as f64 * wy * wx;
                    }
                }
                out[(dy * dst_w + dx) * channels + c] = sum.round().clamp(0.0, 255.0) as u8;
            }
        }
    }
    out
}
