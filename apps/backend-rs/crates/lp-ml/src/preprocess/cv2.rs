//! OpenCV's 8-bit `cv2.resize` (no antialiasing), as PP-OCR and insightface
//! call it. `INTER_LINEAR` follows `imgproc/src/resize.cpp`: 11-bit
//! fixed-point weights, an int horizontal pass, and the vectorised vertical
//! pass's rounding (`((S0 >> 4) * b0 >> 16) + ((S1 >> 4) * b1 >> 16) + 2 >> 2`),
//! which is what x86 (SSE/AVX) and ARM (NEON) builds run for all but the last
//! few pixels of a row. An exact 2x downscale is `INTER_AREA`, as in OpenCV.
//! `INTER_AREA` follows `resizeAreaFast_` / `resizeArea_`. Both are bit-exact
//! against opencv-python 5.0 on x86.

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

    // Columns past an edge take the edge pixel with weight 1; rows keep
    // their fraction and clamp only the row index (both taps then read the
    // edge row, and the vertical pass truncates each product separately).
    let tab = |dst: usize, src_len: usize, scale: f64, clamp: bool| -> Vec<(i64, i32, i32)> {
        (0..dst)
            .map(|d| {
                let f = ((d as f64 + 0.5) * scale - 0.5) as f32;
                let mut s = f.floor() as i64;
                let mut f = f - s as f32;
                if clamp && s < 0 {
                    f = 0.0;
                    s = 0;
                }
                if clamp && s >= src_len as i64 - 1 {
                    f = 0.0;
                    s = src_len as i64 - 1;
                }
                // saturate_cast<short>(float) = cvRound: half to even.
                let a0 = ((1.0 - f) * SCALE).round_ties_even() as i32;
                let a1 = (f * SCALE).round_ties_even() as i32;
                (s, a0, a1)
            })
            .collect()
    };
    let xt = tab(dst_w, w, scale_x, true);
    let yt = tab(dst_h, h, scale_y, false);
    let row = |y: i64| y.clamp(0, h as i64 - 1) as usize;

    let hrow = |y: usize| -> Vec<i32> {
        let line = &src[y * w * channels..(y + 1) * w * channels];
        let mut out = vec![0i32; dst_w * channels];
        for (dx, &(sx, a0, a1)) in xt.iter().enumerate() {
            let sx = sx as usize;
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
    let mut rows: Option<(usize, usize)> = None;
    let (mut r0, mut r1) = (Vec::new(), Vec::new());
    for (dy, &(sy, b0, b1)) in yt.iter().enumerate() {
        let key = (row(sy), row(sy + 1));
        if rows != Some(key) {
            (r0, r1) = (hrow(key.0), hrow(key.1));
            rows = Some(key);
        }
        let line = &mut out[dy * dst_w * channels..(dy + 1) * dst_w * channels];
        for (i, o) in line.iter_mut().enumerate() {
            let s0 = (r0[i] >> 4).clamp(i16::MIN as i32, i16::MAX as i32);
            let s1 = (r1[i] >> 4).clamp(i16::MIN as i32, i16::MAX as i32);
            let t = ((s0 * b0) >> 16) + ((s1 * b1) >> 16);
            let t = t.clamp(i16::MIN as i32, i16::MAX as i32);
            *o = ((t + 2) >> 2).clamp(0, 255) as u8;
        }
    }
    out
}

/// `cv2.resize(..., interpolation=cv2.INTER_AREA)` for downscaling, as
/// `resizeAreaFast_` (integer factors: an exact 2x rounds `(sum + 2) >> 2`,
/// others `cvRound(sum * (1.f / n))`) and `resizeArea_` (f32 area weights
/// from `computeResizeAreaTab`, rows accumulated in f32, `cvRound`).
pub fn resize_area(
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
    let scale_x = 1.0 / (dst_w as f64 / w as f64);
    let scale_y = 1.0 / (dst_h as f64 / h as f64);
    let (ix, iy) = (
        scale_x.round_ties_even() as usize,
        scale_y.round_ties_even() as usize,
    );
    if (scale_x - ix as f64).abs() < f64::EPSILON && (scale_y - iy as f64).abs() < f64::EPSILON {
        return area_fast(src, w, channels, dst_w, dst_h, ix, iy);
    }
    let xt = area_tab(w, dst_w, scale_x);
    let yt = area_tab(h, dst_h, scale_y);
    let row_len = dst_w * channels;
    let mut out = vec![0u8; dst_h * row_len];
    let mut buf = vec![0f32; row_len];
    let mut sum = vec![0f32; row_len];
    let mut prev = yt.first().map_or(0, |t| t.0);
    let flush = |out: &mut [u8], dy: usize, sum: &[f32]| {
        for (o, &v) in out[dy * row_len..(dy + 1) * row_len].iter_mut().zip(sum) {
            *o = v.round_ties_even().clamp(0.0, 255.0) as u8;
        }
    };
    for &(dy, sy, beta) in &yt {
        buf.fill(0.0);
        let line = &src[sy * w * channels..(sy + 1) * w * channels];
        for &(dx, sx, alpha) in &xt {
            for c in 0..channels {
                let d = dx * channels + c;
                buf[d] += line[sx * channels + c] as f32 * alpha;
            }
        }
        if dy != prev {
            flush(&mut out, prev, &sum);
            for (s, b) in sum.iter_mut().zip(&buf) {
                *s = beta * b;
            }
            prev = dy;
        } else {
            for (s, b) in sum.iter_mut().zip(&buf) {
                *s += beta * b;
            }
        }
    }
    flush(&mut out, prev, &sum);
    out
}

/// `resizeAreaFast_` for integer factors `fx` x `fy`.
fn area_fast(
    src: &[u8],
    w: usize,
    channels: usize,
    dst_w: usize,
    dst_h: usize,
    fx: usize,
    fy: usize,
) -> Vec<u8> {
    let n = (fx * fy) as u32;
    let scale = 1.0f32 / n as f32;
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
                out[(dy * dst_w + dx) * channels + c] = if fx == 2 && fy == 2 {
                    ((sum + 2) >> 2) as u8
                } else {
                    (sum as f32 * scale).round_ties_even().clamp(0.0, 255.0) as u8
                };
            }
        }
    }
    out
}

/// `computeResizeAreaTab`: `(dst index, src index, weight)` in OpenCV's order.
fn area_tab(ssize: usize, dsize: usize, scale: f64) -> Vec<(usize, usize, f32)> {
    let mut tab = Vec::with_capacity(ssize * 2);
    for dx in 0..dsize {
        let fsx1 = dx as f64 * scale;
        let fsx2 = fsx1 + scale;
        let cell = scale.min(ssize as f64 - fsx1);
        let sx2 = (fsx2.floor() as i64).min(ssize as i64 - 1);
        let sx1 = (fsx1.ceil() as i64).min(sx2);
        if sx1 as f64 - fsx1 > 1e-3 {
            tab.push((dx, (sx1 - 1) as usize, ((sx1 as f64 - fsx1) / cell) as f32));
        }
        for sx in sx1..sx2 {
            tab.push((dx, sx as usize, (1.0 / cell) as f32));
        }
        if fsx2 - sx2 as f64 > 1e-3 {
            tab.push((
                dx,
                sx2 as usize,
                ((fsx2 - sx2 as f64).min(1.0).min(cell) / cell) as f32,
            ));
        }
    }
    tab
}
