//! Pyramid geometry (levels, tile grid, bands), orientation of rectangles, box reduction and
//! cropping. Pure functions, no I/O.
//!
//! Level 0 is the full resolution; level `L` is `ceil(w / 2^L)` x `ceil(h / 2^L)`. Tiles are
//! `TILE` x `TILE` in the oriented (displayed) image, edge tiles smaller. Each tile also carries
//! `OVERLAP` pixels of its neighbours on every side that has one (like Deep Zoom's overlap), so a
//! renderer that interpolates while scaling sees the same pixels at a tile's edge as inside it.
//!
//! Tiles are produced a *band* at a time: one row of tiles (or one column when the orientation
//! swaps the axes), which is a run of full-width rows of the stored image. Decoders stream rows
//! forward cheaply, so a band is the natural unit of work.

use crate::orient;
use crate::pixels::Pixels;

pub const TILE: u32 = 512;
pub const OVERLAP: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

/// Number of pyramid levels: level `levels - 1` fits into one tile.
pub fn level_count(w: u32, h: u32) -> u32 {
    let mut n = 1;
    let mut m = w.max(h);
    while m > TILE {
        m = m.div_ceil(2);
        n += 1;
    }
    n
}

pub fn level_dims(w: u32, h: u32, level: u32) -> (u32, u32) {
    let d = 1u32 << level.min(31);
    (w.div_ceil(d).max(1), h.div_ceil(d).max(1))
}

/// The stored rectangle that orientation `o` turns into the displayed rectangle `r`.
/// `sw`x`sh` is the stored size (at the same level as `r`).
pub fn to_stored(o: u16, sw: u32, sh: u32, r: Rect) -> Rect {
    let t = |x, y| Rect {
        x,
        y,
        w: r.h,
        h: r.w,
    };
    let s = |x, y| Rect {
        x,
        y,
        w: r.w,
        h: r.h,
    };
    match o {
        2 => s(sw - (r.x + r.w), r.y),
        3 => s(sw - (r.x + r.w), sh - (r.y + r.h)),
        4 => s(r.x, sh - (r.y + r.h)),
        5 => t(r.y, r.x),
        6 => t(r.y, sh - (r.x + r.w)),
        7 => t(sw - (r.y + r.h), sh - (r.x + r.w)),
        8 => t(sw - (r.y + r.h), r.x),
        _ => r,
    }
}

/// The tile grid of one level of an image.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Level {
    /// Stored size at this level.
    pub sw: u32,
    pub sh: u32,
    /// Displayed (oriented) size at this level.
    pub ow: u32,
    pub oh: u32,
    pub orientation: u16,
}

impl Level {
    /// `w`x`h` is the stored full-resolution size.
    pub fn new(w: u32, h: u32, orientation: u16, level: u32) -> Level {
        let (sw, sh) = level_dims(w, h, level);
        let (ow, oh) = orient::oriented_dims(sw, sh, orientation);
        Level {
            sw,
            sh,
            ow,
            oh,
            orientation,
        }
    }

    pub fn cols(&self) -> u32 {
        self.ow.div_ceil(TILE)
    }

    pub fn rows(&self) -> u32 {
        self.oh.div_ceil(TILE)
    }

    pub fn contains(&self, x: u32, y: u32) -> bool {
        x < self.cols() && y < self.rows()
    }

    /// Bands run along displayed columns when the orientation swaps the axes.
    pub fn columns_are_bands(&self) -> bool {
        orient::swaps_axes(self.orientation)
    }

    pub fn band_count(&self) -> u32 {
        if self.columns_are_bands() {
            self.cols()
        } else {
            self.rows()
        }
    }

    pub fn band_of(&self, x: u32, y: u32) -> u32 {
        if self.columns_are_bands() { x } else { y }
    }

    /// Displayed rectangle of tile (`x`, `y`) including its overlap with the neighbours.
    pub fn tile_rect(&self, x: u32, y: u32) -> Rect {
        let (x0, y0) = (
            (x * TILE).saturating_sub(OVERLAP),
            (y * TILE).saturating_sub(OVERLAP),
        );
        let x1 = ((x + 1) * TILE + OVERLAP).min(self.ow);
        let y1 = ((y + 1) * TILE + OVERLAP).min(self.oh);
        Rect {
            x: x0,
            y: y0,
            w: x1 - x0,
            h: y1 - y0,
        }
    }

    /// Displayed rectangle of band `b` (all its tiles, overlap included).
    pub fn band_rect(&self, b: u32) -> Rect {
        if self.columns_are_bands() {
            let r = self.tile_rect(b, 0);
            Rect {
                y: 0,
                h: self.oh,
                ..r
            }
        } else {
            let r = self.tile_rect(0, b);
            Rect {
                x: 0,
                w: self.ow,
                ..r
            }
        }
    }

    /// Stored rows `[start, end)` of band `b` (it always spans the full stored width).
    pub fn band_rows(&self, b: u32) -> (u32, u32) {
        let r = to_stored(self.orientation, self.sw, self.sh, self.band_rect(b));
        debug_assert_eq!((r.x, r.w), (0, self.sw));
        (r.y, r.y + r.h)
    }

    /// Tiles of band `b` with their rectangles inside the displayed band.
    pub fn band_tiles(&self, b: u32) -> Vec<(u32, u32, Rect)> {
        let band = self.band_rect(b);
        let at = |x: u32, y: u32| {
            let r = self.tile_rect(x, y);
            (
                x,
                y,
                Rect {
                    x: r.x - band.x,
                    y: r.y - band.y,
                    ..r
                },
            )
        };
        if self.columns_are_bands() {
            (0..self.rows()).map(|j| at(b, j)).collect()
        } else {
            (0..self.cols()).map(|i| at(i, b)).collect()
        }
    }
}

/// Average `f`x`f` blocks (partial blocks at the right and bottom edges average what they have).
pub fn box_reduce(p: &Pixels, f: u32) -> Pixels {
    if f <= 1 {
        return p.clone();
    }
    let bpp = p.format.bytes_per_pixel();
    let (w, h) = (p.width as usize, p.height as usize);
    let (ow, oh) = (p.width.div_ceil(f) as usize, p.height.div_ceil(f) as usize);
    let f = f as usize;
    let mut out = vec![0u8; ow * oh * bpp];
    let mut acc = vec![0u32; ow * bpp];
    for oy in 0..oh {
        acc.iter_mut().for_each(|a| *a = 0);
        let (y0, y1) = (oy * f, ((oy + 1) * f).min(h));
        for y in y0..y1 {
            let row = &p.data[y * w * bpp..(y + 1) * w * bpp];
            for (x, px) in row.chunks_exact(bpp).enumerate() {
                let a = &mut acc[(x / f) * bpp..(x / f + 1) * bpp];
                for (s, &v) in a.iter_mut().zip(px) {
                    *s += v as u32;
                }
            }
        }
        let rows = (y1 - y0) as u32;
        let dst = &mut out[oy * ow * bpp..(oy + 1) * ow * bpp];
        for ox in 0..ow {
            let cols = (((ox + 1) * f).min(w) - ox * f) as u32;
            let n = rows * cols;
            for c in 0..bpp {
                dst[ox * bpp + c] = ((acc[ox * bpp + c] + n / 2) / n) as u8;
            }
        }
    }
    Pixels {
        width: ow as u32,
        height: oh as u32,
        format: p.format,
        data: out,
    }
}

pub fn crop(p: &Pixels, r: Rect) -> Pixels {
    let bpp = p.format.bytes_per_pixel();
    let row = r.w as usize * bpp;
    let mut data = Vec::with_capacity(row * r.h as usize);
    for y in r.y..r.y + r.h {
        let start = (y as usize * p.width as usize + r.x as usize) * bpp;
        data.extend_from_slice(&p.data[start..start + row]);
    }
    Pixels {
        width: r.w,
        height: r.h,
        format: p.format,
        data,
    }
}

/// Stack row runs of the same width and format.
pub fn stack(parts: Vec<Pixels>) -> Option<Pixels> {
    let mut it = parts.into_iter();
    let mut first = it.next()?;
    for p in it {
        first.height += p.height;
        first.data.extend_from_slice(&p.data);
    }
    Some(first)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pixels::PixFmt;

    fn gray(w: u32, h: u32) -> Pixels {
        let data = (0..w * h).flat_map(|i| [(i % 251) as u8; 3]).collect();
        Pixels {
            width: w,
            height: h,
            format: PixFmt::Rgb8,
            data,
        }
    }

    #[test]
    fn levels() {
        assert_eq!(level_count(512, 300), 1);
        assert_eq!(level_count(513, 300), 2);
        assert_eq!(level_count(23040, 12960), 7);
        assert_eq!(level_dims(23040, 12960, 3), (2880, 1620));
        assert_eq!(level_dims(1001, 999, 1), (501, 500));
        assert_eq!(level_dims(5, 5, 6), (1, 1));
    }

    #[test]
    fn stored_rects_match_orientation() {
        let (w, h) = (13, 7);
        let img = gray(w, h);
        for o in 1..=8u16 {
            let oriented = orient::apply(img.clone(), o);
            let (ow, oh) = (oriented.width, oriented.height);
            for r in [
                Rect {
                    x: 0,
                    y: 0,
                    w: ow,
                    h: oh,
                },
                Rect {
                    x: 2,
                    y: 1,
                    w: 5,
                    h: 3,
                },
                Rect {
                    x: ow - 4,
                    y: oh - 2,
                    w: 4,
                    h: 2,
                },
            ] {
                let s = to_stored(o, w, h, r);
                let got = orient::apply(crop(&img, s), o);
                assert_eq!(
                    got.data,
                    crop(&oriented, r).data,
                    "orientation {o} rect {r:?}"
                );
            }
        }
    }

    #[test]
    fn bands_cover_the_grid() {
        for o in 1..=8u16 {
            let lv = Level::new(1500, 1100, o, 0);
            let mut seen = std::collections::HashSet::new();
            for b in 0..lv.band_count() {
                let (r0, r1) = lv.band_rows(b);
                assert!(r1 > r0 && r1 <= lv.sh);
                let band = lv.band_rect(b);
                for (x, y, r) in lv.band_tiles(b) {
                    assert_eq!(lv.band_of(x, y), b);
                    assert!(r.x + r.w <= band.w && r.y + r.h <= band.h, "o {o}");
                    assert!(seen.insert((x, y)));
                }
            }
            assert_eq!(seen.len() as u32, lv.cols() * lv.rows());
        }
        let lv = Level::new(1500, 1100, 6, 0);
        assert_eq!((lv.ow, lv.oh, lv.cols(), lv.rows()), (1100, 1500, 3, 3));
        // The first displayed column is the bottom of the stored image (plus 1 px of overlap).
        assert_eq!(lv.band_rows(0), (1100 - 513, 1100));
        assert_eq!(lv.band_rows(2), (0, 1100 - 1023));
        // Overlap: interior tiles have a border on all sides, edge tiles only inside the image.
        let lv = Level::new(1500, 1100, 1, 0);
        assert_eq!(
            lv.tile_rect(0, 0),
            Rect {
                x: 0,
                y: 0,
                w: 513,
                h: 513
            }
        );
        assert_eq!(
            lv.tile_rect(1, 1),
            Rect {
                x: 511,
                y: 511,
                w: 514,
                h: 514
            }
        );
        assert_eq!(
            lv.tile_rect(2, 2),
            Rect {
                x: 1023,
                y: 1023,
                w: 477,
                h: 77
            }
        );
    }

    #[test]
    fn box_reduce_averages_partial_blocks() {
        let p = Pixels {
            width: 3,
            height: 3,
            format: PixFmt::Rgb8,
            data: [0u8, 10, 20, 30, 40, 50, 60, 70, 80]
                .iter()
                .flat_map(|&v| [v; 3])
                .collect(),
        };
        let r = box_reduce(&p, 2);
        assert_eq!((r.width, r.height), (2, 2));
        let v: Vec<u8> = r.data.chunks(3).map(|c| c[0]).collect();
        assert_eq!(v, [20, 35, 65, 80]);
    }

    #[test]
    fn stacks_rows() {
        let a = gray(4, 2);
        let s = stack(vec![
            crop(
                &a,
                Rect {
                    x: 0,
                    y: 0,
                    w: 4,
                    h: 1,
                },
            ),
            crop(
                &a,
                Rect {
                    x: 0,
                    y: 1,
                    w: 4,
                    h: 1,
                },
            ),
        ])
        .unwrap();
        assert_eq!(s.data, a.data);
        assert_eq!(s.height, 2);
    }
}
