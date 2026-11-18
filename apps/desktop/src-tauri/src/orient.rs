//! EXIF orientation: composition (for `rotate_file`) and applying it to pixels.
//!
//! An orientation is modelled as "rotate the stored pixels clockwise by `r` quarter turns, then
//! mirror horizontally if `m`", which covers all eight EXIF values.

use crate::pixels::Pixels;

/// EXIF value (1..=8) -> (quarter turns clockwise, mirrored after the rotation).
pub fn decompose(o: u16) -> (u8, bool) {
    match o {
        2 => (0, true),
        3 => (2, false),
        4 => (2, true),
        5 => (1, true),
        6 => (1, false),
        7 => (3, true),
        8 => (3, false),
        _ => (0, false),
    }
}

pub fn compose(r: u8, m: bool) -> u16 {
    match (r % 4, m) {
        (0, false) => 1,
        (0, true) => 2,
        (2, false) => 3,
        (2, true) => 4,
        (1, true) => 5,
        (1, false) => 6,
        (3, true) => 7,
        _ => 8,
    }
}

/// The orientation after turning the displayed image a further quarter turn.
pub fn rotated(o: u16, clockwise: bool) -> u16 {
    let (r, m) = decompose(o);
    // A rotation after a mirror equals the mirror after the opposite rotation.
    let step: i8 = if clockwise != m { 1 } else { -1 };
    compose((r as i8 + step).rem_euclid(4) as u8, m)
}

/// Orientations 5..=8 swap width and height.
pub fn swaps_axes(o: u16) -> bool {
    (5..=8).contains(&o)
}

pub fn oriented_dims(w: u32, h: u32, o: u16) -> (u32, u32) {
    if swaps_axes(o) { (h, w) } else { (w, h) }
}

/// Apply orientation `o` to `p` (tiled copy, cache friendly for the transposing cases).
pub fn apply(p: Pixels, o: u16) -> Pixels {
    if !(2..=8).contains(&o) {
        return p;
    }
    let (w, h) = (p.width as usize, p.height as usize);
    let bpp = p.format.bytes_per_pixel();
    let (dw, dh) = if swaps_axes(o) { (h, w) } else { (w, h) };
    let mut out = vec![0u8; p.data.len()];
    // Destination coordinates of source pixel (x, y).
    let map = |x: usize, y: usize| -> (usize, usize) {
        match o {
            2 => (w - 1 - x, y),
            3 => (w - 1 - x, h - 1 - y),
            4 => (x, h - 1 - y),
            5 => (y, x),
            6 => (h - 1 - y, x),
            7 => (h - 1 - y, w - 1 - x),
            _ => (y, w - 1 - x),
        }
    };
    const T: usize = 64;
    let src = &p.data;
    for ty in (0..h).step_by(T) {
        for tx in (0..w).step_by(T) {
            for y in ty..(ty + T).min(h) {
                for x in tx..(tx + T).min(w) {
                    let (dx, dy) = map(x, y);
                    let s = (y * w + x) * bpp;
                    let d = (dy * dw + dx) * bpp;
                    out[d..d + bpp].copy_from_slice(&src[s..s + bpp]);
                }
            }
        }
    }
    debug_assert_eq!(dh * dw * bpp, out.len());
    Pixels {
        width: dw as u32,
        height: dh as u32,
        format: p.format,
        data: out,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pixels::PixFmt;

    #[test]
    fn decompose_compose_roundtrip() {
        for o in 1..=8 {
            let (r, m) = decompose(o);
            assert_eq!(compose(r, m), o);
        }
    }

    #[test]
    fn rotation_cycles() {
        assert_eq!(rotated(1, true), 6);
        assert_eq!(rotated(6, true), 3);
        assert_eq!(rotated(3, true), 8);
        assert_eq!(rotated(8, true), 1);
        assert_eq!(rotated(1, false), 8);
        assert_eq!(rotated(6, false), 1);
        // Mirrored: a clockwise turn of a horizontally flipped image is the transverse.
        assert_eq!(rotated(2, true), 7);
        for o in 1..=8 {
            assert_eq!(rotated(rotated(o, true), false), o);
            let mut x = o;
            for _ in 0..4 {
                x = rotated(x, true);
            }
            assert_eq!(x, o);
        }
    }

    fn img() -> Pixels {
        // 3x2 grayscale-ish RGB image, pixel value = index.
        let data = (0u8..6).flat_map(|v| [v, v, v]).collect();
        Pixels {
            width: 3,
            height: 2,
            format: PixFmt::Rgb8,
            data,
        }
    }

    fn values(p: &Pixels) -> Vec<u8> {
        p.data.chunks(3).map(|c| c[0]).collect()
    }

    #[test]
    fn applies_orientation_to_pixels() {
        // 0 1 2
        // 3 4 5
        assert_eq!(values(&apply(img(), 1)), [0, 1, 2, 3, 4, 5]);
        assert_eq!(values(&apply(img(), 2)), [2, 1, 0, 5, 4, 3]);
        assert_eq!(values(&apply(img(), 3)), [5, 4, 3, 2, 1, 0]);
        assert_eq!(values(&apply(img(), 4)), [3, 4, 5, 0, 1, 2]);
        let r = apply(img(), 6); // 90 cw
        assert_eq!((r.width, r.height), (2, 3));
        assert_eq!(values(&r), [3, 0, 4, 1, 5, 2]);
        assert_eq!(values(&apply(img(), 8)), [2, 5, 1, 4, 0, 3]);
        assert_eq!(values(&apply(img(), 5)), [0, 3, 1, 4, 2, 5]);
        assert_eq!(values(&apply(img(), 7)), [5, 2, 4, 1, 3, 0]);
    }

    #[test]
    fn apply_matches_decomposition() {
        // Applying o equals rotating r quarter turns then mirroring.
        for o in 1..=8u16 {
            let (r, m) = decompose(o);
            let mut p = img();
            for _ in 0..r {
                p = apply(p, 6);
            }
            if m {
                p = apply(p, 2);
            }
            assert_eq!(values(&p), values(&apply(img(), o)), "orientation {o}");
        }
    }
}
