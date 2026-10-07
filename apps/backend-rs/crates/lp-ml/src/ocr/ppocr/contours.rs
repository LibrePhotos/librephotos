//! `cv2.findContours(bitmap, RETR_LIST, CHAIN_APPROX_SIMPLE)`: OpenCV 5's
//! Suzuki-Abe border following (`imgproc/src/contours_new.cpp`, the path the
//! Python binding takes because it always asks for the hierarchy), with the
//! same point order and the same contour order (last found first).

/// Chain code directions: right, up-right, up, up-left, left, down-left, down, down-right.
const DELTAS: [(i32, i32); 8] = [
    (1, 0),
    (1, -1),
    (0, -1),
    (-1, -1),
    (-1, 0),
    (-1, 1),
    (0, 1),
    (1, 1),
];

/// `nbd | MASK8_RIGHT` as a signed byte.
const RIGHT: i8 = (0x02u8 | 0x80u8) as i8;
const NEW: i8 = 0x02;

/// Contours of the non-zero pixels of a `w` x `h` bitmap, each as `[x, y]`
/// points (the compressed chain, as `CHAIN_APPROX_SIMPLE` returns it).
pub fn find_contours(bitmap: &[u8], w: usize, h: usize) -> Vec<Vec<[i32; 2]>> {
    assert_eq!(bitmap.len(), w * h, "bitmap size");
    let step = w + 2;
    let mut img = vec![0i8; step * (h + 2)];
    for y in 0..h {
        for x in 0..w {
            img[(y + 1) * step + x + 1] = (bitmap[y * w + x] != 0) as i8;
        }
    }
    let delta = |s: i32| -> isize {
        let (dx, dy) = DELTAS[(s & 7) as usize];
        dx as isize + dy as isize * step as isize
    };
    let width = step as i32 - 1;
    let height = (h + 2) as i32 - 1;

    let mut found: Vec<Vec<[i32; 2]>> = Vec::new();
    let (mut x, mut y) = (1i32, 1i32);
    let at = |img: &[i8], x: i32, y: i32| img[y as usize * step + x as usize];
    let mut prev = at(&img, x - 1, y);
    while y < height {
        let mut p: i8 = 0;
        while x < width {
            while x < width {
                p = at(&img, x, y);
                if p != prev {
                    break;
                }
                x += 1;
            }
            if x >= width {
                break;
            }
            let start = if prev == 0 && p == 1 {
                Some(false)
            } else if p == 0 && prev >= 1 {
                Some(true)
            } else {
                None
            };
            if let Some(is_hole) = start {
                let sx = x - is_hole as i32;
                found.push(fetch(&mut img, step, sx, y, is_hole, &delta));
                // The scan resumes right after the start pixel, re-reading
                // the (now marked) pixel to its left.
                x += 1;
                prev = at(&img, x - 1, y);
                continue;
            }
            prev = p;
            x += 1;
        }
        y += 1;
        x = 1;
        prev = 0;
    }
    found.reverse();
    found
}

/// `icvFetchContourEx<schar>` with `CHAIN_APPROX_SIMPLE`: follow one border
/// from `(sx, sy)` (padded coordinates), marking it, and return its corner
/// points in image coordinates.
fn fetch(
    img: &mut [i8],
    step: usize,
    sx: i32,
    sy: i32,
    is_hole: bool,
    delta: &impl Fn(i32) -> isize,
) -> Vec<[i32; 2]> {
    let mut points = Vec::new();
    let i0 = sy as isize * step as isize + sx as isize;
    let mut pt = [sx - 1, sy - 1];
    let mut s_end: i32 = if is_hole { 0 } else { 4 };
    let mut s = s_end;
    let mut i1;
    loop {
        s = (s - 1) & 7;
        i1 = i0 + delta(s);
        if img[i1 as usize] != 0 || s == s_end {
            break;
        }
    }
    if s == s_end {
        img[i0 as usize] = RIGHT;
        points.push(pt);
        return points;
    }
    let mut i3 = i0;
    let mut prev_s = s ^ 4;
    loop {
        s_end = s;
        s = s.min(15);
        let mut i4 = i3;
        while s < 15 {
            s += 1;
            i4 = i3 + delta(s);
            if img[i4 as usize] != 0 {
                break;
            }
        }
        s &= 7;
        if ((s - 1) as u32) < (s_end as u32) {
            img[i3 as usize] = RIGHT;
        } else if img[i3 as usize] == 1 {
            img[i3 as usize] = NEW;
        }
        if s != prev_s {
            points.push(pt);
        }
        prev_s = s;
        let (dx, dy) = DELTAS[s as usize];
        pt = [pt[0] + dx, pt[1] + dy];
        if i4 == i0 && i3 == i1 {
            break;
        }
        i3 = i4;
        s = (s + 4) & 7;
    }
    points
}
