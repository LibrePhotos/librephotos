//! Polygon helpers of the DB postprocess: `cv2.fillPoly` (OpenCV 5
//! `drawing.cpp`, 8-connected, no shift), PaddleOCR's `box_score_fast`, the
//! shoelace area / perimeter and pyclipper's round-join offset (Clipper
//! 6.4.2) that `unclip` expands a box with.

/// `cv2.fillPoly(mask, [pts], 1)` on a `w` x `h` u8 mask.
pub fn fill_poly(mask: &mut [u8], w: usize, h: usize, pts: &[[i32; 2]]) {
    const SHIFT: i64 = 16;
    let (wi, hi) = (w as i64, h as i64);
    let mut edges: Vec<Edge> = Vec::with_capacity(pts.len() + 1);
    let n = pts.len();
    if n == 0 {
        return;
    }
    let mut pt0 = [(pts[n - 1][0] as i64) << SHIFT, pts[n - 1][1] as i64];
    for p in pts {
        let pt1 = [(p[0] as i64) << SHIFT, p[1] as i64];
        let mut t0 = [(pt0[0] + (1 << (SHIFT - 1))) >> SHIFT, pt0[1]];
        let mut t1 = [(pt1[0] + (1 << (SHIFT - 1))) >> SHIFT, pt1[1]];
        line(mask, w, h, [t0[0], t0[1]], [t1[0], t1[1]]);
        let (mut c0y, mut c1y) = (pt0[1], pt1[1]);
        if !(0..wi).contains(&t0[0])
            || !(0..wi).contains(&t1[0])
            || !(0..hi).contains(&t0[1])
            || !(0..hi).contains(&t1[1])
        {
            clip_line(wi, hi, &mut t0, &mut t1);
            if t0[1] != t1[1] {
                c0y = t0[1];
                c1y = t1[1];
            }
        }
        let c0x = t0[0] << SHIFT;
        let c1x = t1[0] << SHIFT;
        if pt0[1] != pt1[1] {
            let dx = (c1x - c0x) / (c1y - c0y);
            let e = if pt0[1] < pt1[1] {
                Edge {
                    y0: pt0[1],
                    y1: pt1[1],
                    x: c0x + (pt0[1] - c0y) * dx,
                    dx,
                    next: NIL,
                }
            } else {
                Edge {
                    y0: pt1[1],
                    y1: pt0[1],
                    x: c1x + (pt1[1] - c1y) * dx,
                    dx,
                    next: NIL,
                }
            };
            edges.push(e);
        }
        pt0 = pt1;
    }
    fill_edges(mask, w, h, edges);
}

const NIL: usize = usize::MAX;
const HEAD: usize = usize::MAX - 1;

#[derive(Debug, Clone, Copy)]
struct Edge {
    y0: i64,
    y1: i64,
    x: i64,
    dx: i64,
    next: usize,
}

/// `FillEdgeCollection` (the scanline fill with its active edge list).
fn fill_edges(mask: &mut [u8], w: usize, h: usize, mut edges: Vec<Edge>) {
    const SHIFT: i64 = 16;
    let delta: i64 = (1 << SHIFT) - 1;
    let total = edges.len();
    if total < 2 {
        return;
    }
    let (mut y_max, mut y_min) = (i64::MIN, i64::MAX);
    let (mut x_max, mut x_min) = (-1i64, i64::MAX);
    for e in &edges {
        let x1 = e.x + (e.y1 - e.y0) * e.dx;
        y_min = y_min.min(e.y0);
        y_max = y_max.max(e.y1);
        x_min = x_min.min(e.x).min(x1);
        x_max = x_max.max(e.x).max(x1);
    }
    if y_max < 0 || y_min >= h as i64 || x_max < 0 || x_min >= (w as i64) << SHIFT {
        return;
    }
    edges.sort_by(|a, b| a.y0.cmp(&b.y0).then(a.x.cmp(&b.x)).then(a.dx.cmp(&b.dx)));
    edges.push(Edge {
        y0: i64::MAX,
        y1: 0,
        x: 0,
        dx: 0,
        next: NIL,
    });
    let mut head_next = NIL;
    let mut i = 0usize;
    let mut e = 0usize;
    let y_max = y_max.min(h as i64);

    macro_rules! next_of {
        ($n:expr) => {
            if $n == HEAD {
                head_next
            } else {
                edges[$n].next
            }
        };
    }
    macro_rules! set_next {
        ($n:expr, $v:expr) => {{
            let v = $v;
            if $n == HEAD {
                head_next = v;
            } else {
                edges[$n].next = v;
            }
        }};
    }

    let mut y = edges[0].y0;
    while y < y_max {
        let mut draw = false;
        let clipline = y < 0;
        let mut prelast = HEAD;
        let mut last = head_next;
        while last != NIL || edges[e].y0 == y {
            if last != NIL && edges[last].y1 == y {
                let nx = edges[last].next;
                set_next!(prelast, nx);
                last = nx;
                continue;
            }
            let keep_prelast = prelast;
            if last != NIL && (edges[e].y0 > y || edges[last].x < edges[e].x) {
                prelast = last;
                last = edges[last].next;
            } else if i < total {
                set_next!(prelast, e);
                edges[e].next = last;
                prelast = e;
                i += 1;
                e = i;
            } else {
                break;
            }
            if draw {
                if !clipline {
                    let (kx, px) = (edges[keep_prelast].x, edges[prelast].x);
                    let (mut x1, mut x2) = if kx > px {
                        ((px + delta) >> SHIFT, kx >> SHIFT)
                    } else {
                        ((kx + delta) >> SHIFT, px >> SHIFT)
                    };
                    if x1 < w as i64 && x2 >= 0 {
                        x1 = x1.max(0);
                        x2 = x2.min(w as i64 - 1);
                        let row = y as usize * w;
                        if x1 <= x2 {
                            mask[row + x1 as usize..=row + x2 as usize].fill(1);
                        }
                    }
                }
                let d = edges[keep_prelast].dx;
                edges[keep_prelast].x += d;
                let d = edges[prelast].dx;
                edges[prelast].x += d;
            }
            draw = !draw;
        }

        // bubble sort of the active list by x
        let mut keep_prelast = NIL;
        loop {
            let mut prelast = HEAD;
            let mut last = head_next;
            let mut last_exchange = NIL;
            while last != keep_prelast && edges[last].next != NIL {
                let te = edges[last].next;
                if edges[last].x > edges[te].x {
                    set_next!(prelast, te);
                    edges[last].next = edges[te].next;
                    edges[te].next = last;
                    prelast = te;
                    last_exchange = prelast;
                } else {
                    prelast = last;
                    last = te;
                }
            }
            if last_exchange == NIL {
                break;
            }
            keep_prelast = last_exchange;
            if keep_prelast == next_of!(HEAD) || keep_prelast == HEAD {
                break;
            }
        }
        y += 1;
    }
}

/// OpenCV's `clipLine(Size2l, pt1, pt2)`; true when the result is inside.
fn clip_line(w: i64, h: i64, p1: &mut [i64; 2], p2: &mut [i64; 2]) -> bool {
    let (right, bottom) = (w - 1, h - 1);
    if w <= 0 || h <= 0 {
        return false;
    }
    let code = |p: &[i64; 2]| {
        (p[0] < 0) as i32
            + (p[0] > right) as i32 * 2
            + (p[1] < 0) as i32 * 4
            + (p[1] > bottom) as i32 * 8
    };
    let (mut c1, mut c2) = (code(p1), code(p2));
    if (c1 & c2) == 0 && (c1 | c2) != 0 {
        if c1 & 12 != 0 {
            let a = if c1 < 8 { 0 } else { bottom };
            p1[0] += ((a - p1[1]) as f64 * (p2[0] - p1[0]) as f64 / (p2[1] - p1[1]) as f64) as i64;
            p1[1] = a;
            c1 = (p1[0] < 0) as i32 + (p1[0] > right) as i32 * 2;
        }
        if c2 & 12 != 0 {
            let a = if c2 < 8 { 0 } else { bottom };
            p2[0] += ((a - p2[1]) as f64 * (p2[0] - p1[0]) as f64 / (p2[1] - p1[1]) as f64) as i64;
            p2[1] = a;
            c2 = (p2[0] < 0) as i32 + (p2[0] > right) as i32 * 2;
        }
        if (c1 & c2) == 0 && (c1 | c2) != 0 {
            if c1 != 0 {
                let a = if c1 == 1 { 0 } else { right };
                p1[1] +=
                    ((a - p1[0]) as f64 * (p2[1] - p1[1]) as f64 / (p2[0] - p1[0]) as f64) as i64;
                p1[0] = a;
                c1 = 0;
            }
            if c2 != 0 {
                let a = if c2 == 1 { 0 } else { right };
                p2[1] +=
                    ((a - p2[0]) as f64 * (p2[1] - p1[1]) as f64 / (p2[0] - p1[0]) as f64) as i64;
                p2[0] = a;
                c2 = 0;
            }
        }
    }
    (c1 | c2) == 0
}

/// `Line(img, pt1, pt2, color, 8)`: 8-connected Bresenham through
/// `LineIterator(leftToRight=true)`, clipped to the image.
fn line(mask: &mut [u8], w: usize, h: usize, a: [i64; 2], b: [i64; 2]) {
    let (wi, hi) = (w as i64, h as i64);
    let (mut p1, mut p2) = (a, b);
    if !(0..wi).contains(&p1[0])
        || !(0..wi).contains(&p2[0])
        || !(0..hi).contains(&p1[1])
        || !(0..hi).contains(&p2[1])
    {
        // cv::clipLine(Size, Point&, Point&) works on int points.
        let mut q1 = [p1[0] as i32 as i64, p1[1] as i32 as i64];
        let mut q2 = [p2[0] as i32 as i64, p2[1] as i32 as i64];
        if !clip_line(wi, hi, &mut q1, &mut q2) {
            return;
        }
        p1 = [q1[0] as i32 as i64, q1[1] as i32 as i64];
        p2 = [q2[0] as i32 as i64, q2[1] as i32 as i64];
    }
    let (mut delta_x, mut delta_y) = (1i64, 1i64);
    let mut dx = p2[0] - p1[0];
    let mut dy = p2[1] - p1[1];
    if dx < 0 {
        dx = -dx;
        dy = -dy;
        p1 = p2;
    }
    if dy < 0 {
        dy = -dy;
        delta_y = -1;
    }
    let vert = dy > dx;
    if vert {
        std::mem::swap(&mut dx, &mut dy);
        std::mem::swap(&mut delta_x, &mut delta_y);
    }
    let mut err = dx - (dy + dy);
    let plus_delta = dx + dx;
    let minus_delta = -(dy + dy);
    // (x step, y step) always taken, and extra when err < 0
    let (mut minus_shift, mut plus_shift, mut minus_step, mut plus_step) =
        (delta_x, 0i64, 0i64, delta_y);
    if vert {
        std::mem::swap(&mut plus_step, &mut plus_shift);
        std::mem::swap(&mut minus_step, &mut minus_shift);
    }
    let count = dx + 1;
    let mut p = p1;
    for _ in 0..count {
        if (0..wi).contains(&p[0]) && (0..hi).contains(&p[1]) {
            mask[p[1] as usize * w + p[0] as usize] = 1;
        }
        let m = if err < 0 { -1i64 } else { 0 };
        err += minus_delta + (plus_delta & m);
        p[0] += minus_shift + (plus_shift & m);
        p[1] += minus_step + (plus_step & m);
    }
}

/// PaddleOCR's `box_score_fast`: mean of `prob` inside the (truncated) quad.
pub fn box_score_fast(prob: &[f32], w: usize, h: usize, quad: &[[f32; 2]; 4]) -> f64 {
    let (mut minx, mut maxx, mut miny, mut maxy) = (f32::MAX, f32::MIN, f32::MAX, f32::MIN);
    for p in quad {
        minx = minx.min(p[0]);
        maxx = maxx.max(p[0]);
        miny = miny.min(p[1]);
        maxy = maxy.max(p[1]);
    }
    let clip = |v: f32, hi: usize| v.clamp(0.0, (hi - 1) as f32) as usize;
    let xmin = clip(minx.floor(), w);
    let xmax = clip(maxx.ceil(), w);
    let ymin = clip(miny.floor(), h);
    let ymax = clip(maxy.ceil(), h);
    let (mw, mh) = (xmax - xmin + 1, ymax - ymin + 1);
    let mut mask = vec![0u8; mw * mh];
    let pts: Vec<[i32; 2]> = quad
        .iter()
        .map(|p| [(p[0] - xmin as f32) as i32, (p[1] - ymin as f32) as i32])
        .collect();
    fill_poly(&mut mask, mw, mh, &pts);
    let mut sum = 0f64;
    let mut n = 0usize;
    for y in 0..mh {
        for x in 0..mw {
            if mask[y * mw + x] != 0 {
                sum += prob[(ymin + y) * w + xmin + x] as f64;
                n += 1;
            }
        }
    }
    if n == 0 { 0.0 } else { sum * (1.0 / n as f64) }
}

/// Shoelace area of a closed polygon (f64, like `polygon_area`).
pub fn polygon_area(pts: &[[f64; 2]]) -> f64 {
    let n = pts.len();
    let (mut a, mut b) = (0f64, 0f64);
    for i in 0..n {
        let j = (i + 1) % n;
        a += pts[i][0] * pts[j][1];
        b += pts[i][1] * pts[j][0];
    }
    0.5 * (a - b).abs()
}

pub fn polygon_perimeter(pts: &[[f64; 2]]) -> f64 {
    let n = pts.len();
    let mut s = 0f64;
    for i in 0..n {
        let j = (i + 1) % n;
        let (dx, dy) = (pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
        s += (dx * dx + dy * dy).sqrt();
    }
    s
}

/// `unclip`: the box grown by `area * ratio / perimeter` with round joins,
/// as pyclipper returns it (union-cleaned: no duplicate or collinear
/// points, the cycle ending at the top-most, right-most vertex). `None`
/// when the offset collapses.
pub fn unclip(quad: &[[f32; 2]; 4], ratio: f64) -> Option<Vec<[i64; 2]>> {
    let pts: Vec<[f64; 2]> = quad.iter().map(|p| [p[0] as f64, p[1] as f64]).collect();
    let perimeter = polygon_perimeter(&pts);
    let distance = if perimeter <= 0.0 {
        0.0
    } else {
        polygon_area(&pts) * ratio / perimeter
    };
    // pyclipper truncates float coordinates to integers.
    let path: Vec<[i64; 2]> = quad.iter().map(|p| [p[0] as i64, p[1] as i64]).collect();
    let offset = clipper_offset(&path, distance)?;
    let mut out = clean(offset);
    if out.len() < 3 {
        return None;
    }
    let min_y = out.iter().map(|p| p[1]).min()?;
    let last = out
        .iter()
        .enumerate()
        .filter(|(_, p)| p[1] == min_y)
        .max_by_key(|(_, p)| p[0])
        .map(|(i, _)| i)?;
    let n = out.len();
    out.rotate_left((last + 1) % n);
    Some(out)
}

fn clipper_round(v: f64) -> i64 {
    if v < 0.0 {
        (v - 0.5) as i64
    } else {
        (v + 0.5) as i64
    }
}

fn clipper_area(p: &[[i64; 2]]) -> f64 {
    let n = p.len();
    if n < 3 {
        return 0.0;
    }
    let mut a = 0f64;
    let mut j = n - 1;
    for i in 0..n {
        a += (p[j][0] as f64 + p[i][0] as f64) * (p[j][1] as f64 - p[i][1] as f64);
        j = i;
    }
    -a * 0.5
}

fn unit_normal(a: [i64; 2], b: [i64; 2]) -> [f64; 2] {
    if a == b {
        return [0.0, 0.0];
    }
    let mut dx = (b[0] - a[0]) as f64;
    let mut dy = (b[1] - a[1]) as f64;
    let f = 1.0 / (dx * dx + dy * dy).sqrt();
    dx *= f;
    dy *= f;
    [dy, -dx]
}

/// `ClipperOffset` (JT_ROUND, ET_CLOSEDPOLYGON, arc tolerance 0.25) on one
/// path: `AddPath` + `FixOrientations` + `DoOffset`, before the union.
fn clipper_offset(path: &[[i64; 2]], delta: f64) -> Option<Vec<[i64; 2]>> {
    let mut hi = path.len().checked_sub(1)?;
    while hi > 0 && path[0] == path[hi] {
        hi -= 1;
    }
    let mut c = vec![path[0]];
    for p in &path[1..=hi] {
        if c.last() != Some(p) {
            c.push(*p);
        }
    }
    if c.len() < 3 {
        return None;
    }
    if clipper_area(&c) < 0.0 {
        c.reverse();
    }
    if delta.abs() < 1.0e-20 {
        return Some(c);
    }
    const TWO_PI: f64 = std::f64::consts::PI * 2.0;
    let arc_tolerance = 0.25;
    let y = if arc_tolerance > delta.abs() * 0.25 {
        delta.abs() * 0.25
    } else {
        arc_tolerance
    };
    let mut steps = std::f64::consts::PI / (1.0 - y / delta.abs()).acos();
    if steps > delta.abs() * std::f64::consts::PI {
        steps = delta.abs() * std::f64::consts::PI;
    }
    let mut sin = (TWO_PI / steps).sin();
    let cos = (TWO_PI / steps).cos();
    let steps_per_rad = steps / TWO_PI;
    if delta < 0.0 {
        sin = -sin;
    }
    let n = c.len();
    let mut normals: Vec<[f64; 2]> = (0..n - 1).map(|j| unit_normal(c[j], c[j + 1])).collect();
    normals.push(unit_normal(c[n - 1], c[0]));
    let at = |j: usize, nrm: [f64; 2]| {
        [
            clipper_round(c[j][0] as f64 + nrm[0] * delta),
            clipper_round(c[j][1] as f64 + nrm[1] * delta),
        ]
    };
    let mut out = Vec::new();
    let mut k = n - 1;
    for j in 0..n {
        let (nk, nj) = (normals[k], normals[j]);
        let mut sin_a = nk[0] * nj[1] - nj[0] * nk[1];
        if (sin_a * delta).abs() < 1.0 {
            let cos_a = nk[0] * nj[0] + nj[1] * nk[1];
            if cos_a > 0.0 {
                out.push(at(j, nk));
                continue;
            }
        } else {
            sin_a = sin_a.clamp(-1.0, 1.0);
        }
        if sin_a * delta < 0.0 {
            out.push(at(j, nk));
            out.push(c[j]);
            out.push(at(j, nj));
        } else {
            let a = sin_a.atan2(nk[0] * nj[0] + nk[1] * nj[1]);
            let steps = (clipper_round(steps_per_rad * a.abs()) as i32).max(1);
            let (mut x, mut y) = (nk[0], nk[1]);
            for _ in 0..steps {
                out.push([
                    clipper_round(c[j][0] as f64 + x * delta),
                    clipper_round(c[j][1] as f64 + y * delta),
                ]);
                let x2 = x;
                x = x * cos - sin * y;
                y = x2 * sin + y * cos;
            }
            out.push(at(j, nj));
        }
        k = j;
    }
    Some(out)
}

/// What Clipper's union leaves of a simple polygon: no repeated and no
/// collinear vertices.
fn clean(mut p: Vec<[i64; 2]>) -> Vec<[i64; 2]> {
    loop {
        if p.len() < 3 {
            return p;
        }
        let n = p.len();
        let found = (0..n).find(|&i| {
            let a = p[(i + n - 1) % n];
            let b = p[i];
            let c = p[(i + 1) % n];
            b == a || (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) == 0
        });
        match found {
            Some(i) => {
                p.remove(i);
            }
            None => return p,
        }
    }
}

/// `order_points_clockwise`: by angle around the (f32) centroid, then
/// rotated to start at the smallest x + y.
pub fn order_points_clockwise(pts: &[[f32; 2]; 4]) -> [[f32; 2]; 4] {
    // numpy's float32 mean (pairwise sum of 4 values = sequential).
    let cx = (((pts[0][0] + pts[1][0]) + pts[2][0]) + pts[3][0]) / 4.0;
    let cy = (((pts[0][1] + pts[1][1]) + pts[2][1]) + pts[3][1]) / 4.0;
    let mut idx = [0usize, 1, 2, 3];
    let ang: Vec<f32> = pts
        .iter()
        .map(|p| ((p[1] - cy) as f64).atan2((p[0] - cx) as f64) as f32)
        .collect();
    idx.sort_by(|&a, &b| {
        ang[a]
            .partial_cmp(&ang[b])
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let ordered = idx.map(|i| pts[i]);
    let mut start = 0;
    for i in 1..4 {
        if ordered[i][0] + ordered[i][1] < ordered[start][0] + ordered[start][1] {
            start = i;
        }
    }
    [0, 1, 2, 3].map(|i| ordered[(start + i) % 4])
}

/// `rescale_quad`: from the detection map's size to the image's, rounded
/// half to even in f32 and clipped.
pub fn rescale_quad(
    b: &[[f32; 2]; 4],
    size: (usize, usize),
    dest: (usize, usize),
) -> [[i32; 2]; 4] {
    let (w, h) = (size.0 as f32, size.1 as f32);
    let (dw, dh) = (dest.0 as f32, dest.1 as f32);
    b.map(|p| {
        [
            (p[0] / w * dw).round_ties_even().clamp(0.0, dw) as i32,
            (p[1] / h * dh).round_ties_even().clamp(0.0, dh) as i32,
        ]
    })
}
