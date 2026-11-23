//! `cv2.minAreaRect` + `cv2.boxPoints` as OpenCV 5 computes them
//! (`geometry/src/convhull.cpp`, `rotcalipers.cpp`, `core/src/types.cpp`),
//! float for float: PaddleOCR truncates and floors the corners, so an ulp
//! decides which pixel a box starts at.

use std::f64::consts::PI;

/// Point coordinates of a hull input: contours are `i32` (`CV_32S`), the
/// unclipped polygon is cast to `f32` (`CV_32F`), and OpenCV runs a
/// different Sklansky for each.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Pts<'a> {
    Int(&'a [[i32; 2]]),
    Float(&'a [[f32; 2]]),
}

impl Pts<'_> {
    fn len(&self) -> usize {
        match self {
            Pts::Int(p) => p.len(),
            Pts::Float(p) => p.len(),
        }
    }

    fn get(&self, i: usize) -> [f32; 2] {
        match self {
            Pts::Int(p) => [p[i][0] as f32, p[i][1] as f32],
            Pts::Float(p) => p[i],
        }
    }

    fn same(&self, a: usize, b: usize) -> bool {
        match self {
            Pts::Int(p) => p[a] == p[b],
            Pts::Float(p) => p[a] == p[b],
        }
    }
}

/// `RotatedRect` as Python gets it: `((cx, cy), (w, h), angle)`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RotatedRect {
    pub center: [f32; 2],
    pub size: [f32; 2],
    pub angle: f32,
}

fn sign_i64(v: i64) -> i32 {
    (v > 0) as i32 - (v < 0) as i32
}

fn sign_f64(v: f64) -> i32 {
    (v > 0.0) as i32 - (v < 0.0) as i32
}

/// `cv::normalize(Vec2f)`: the norm in f32, the scale in f64.
fn normalize(v: [f32; 2]) -> [f32; 2] {
    let s = v[0] * v[0] + v[1] * v[1];
    let nv = s.sqrt() as f64;
    let alpha = if nv != 0.0 { 1.0 / nv } else { 0.0 };
    [(v[0] as f64 * alpha) as f32, (v[1] as f64 * alpha) as f32]
}

/// `Sklansky_`: one quarter of the hull over `order` (indices into `pts`
/// sorted by x, y), from `start` to `end`. Writes to `stack[base..]`.
#[allow(clippy::too_many_arguments)]
fn sklansky(
    pts: &Pts,
    order: &[usize],
    start: isize,
    end: isize,
    stack: &mut [isize],
    base: usize,
    nsign: i32,
    sign2: i32,
) -> usize {
    let incr: isize = if end > start { 1 } else { -1 };
    let mut pprev = start;
    let mut pcur = pprev + incr;
    let mut pnext = pcur + incr;
    let mut stacksize: usize = 3;
    let at = |i: isize| order[i as usize];
    if start == end || pts.same(at(start), at(end)) {
        stack[base] = start;
        return 1;
    }
    stack[base] = pprev;
    stack[base + 1] = pcur;
    stack[base + 2] = pnext;
    let end = end + incr;
    while pnext != end {
        let (pc, pn, pp) = (at(pcur), at(pnext), at(pprev));
        let (by_sign, convex, a_nonzero) = match pts {
            Pts::Int(p) => {
                let cury = p[pc][1];
                let by = p[pn][1] - cury;
                let a = [p[pc][0] - p[pp][0], cury - p[pp][1]];
                let b = [p[pn][0] - p[pc][0], by];
                let c = a[1] as i64 * b[0] as i64 - a[0] as i64 * b[1] as i64;
                (sign_i64(by as i64), sign_i64(c), a[0] != 0 || a[1] != 0)
            }
            Pts::Float(p) => {
                let cury = p[pc][1];
                let by = p[pn][1] - cury;
                let a = normalize([p[pc][0] - p[pp][0], cury - p[pp][1]]);
                let b = normalize([p[pn][0] - p[pc][0], by]);
                let c = a[1] as f64 * b[0] as f64 - a[0] as f64 * b[1] as f64;
                (
                    (by > 0.0) as i32 - (by < 0.0) as i32,
                    sign_f64(c),
                    a[0] != 0.0 || a[1] != 0.0,
                )
            }
        };
        if by_sign != nsign {
            if convex == sign2 && a_nonzero {
                pprev = pcur;
                pcur = pnext;
                pnext += incr;
                stack[base + stacksize] = pnext;
                stacksize += 1;
            } else if pprev == start {
                pcur = pnext;
                stack[base + 1] = pcur;
                pnext += incr;
                stack[base + 2] = pnext;
            } else {
                stack[base + stacksize - 2] = pnext;
                pcur = pprev;
                pprev = stack[base + stacksize - 4];
                stacksize -= 1;
            }
        } else {
            pnext += incr;
            stack[base + stacksize - 1] = pnext;
        }
    }
    stacksize - 1
}

/// `cv::convexHull(points, clockwise=false, returnPoints=true)`: indices of
/// the hull points in `pts`, in OpenCV's output order.
pub fn convex_hull(pts: &Pts) -> Vec<usize> {
    let total = pts.len();
    if total == 0 {
        return Vec::new();
    }
    let mut order: Vec<usize> = (0..total).collect();
    order.sort_by(|&a, &b| {
        let (pa, pb) = (pts.get(a), pts.get(b));
        match pts {
            Pts::Int(p) => p[a][0]
                .cmp(&p[b][0])
                .then(p[a][1].cmp(&p[b][1]))
                .then(a.cmp(&b)),
            Pts::Float(_) => pa[0]
                .partial_cmp(&pb[0])
                .unwrap_or(std::cmp::Ordering::Equal)
                .then(
                    pa[1]
                        .partial_cmp(&pb[1])
                        .unwrap_or(std::cmp::Ordering::Equal),
                )
                .then(a.cmp(&b)),
        }
    });
    let y_of = |i: usize| pts.get(order[i])[1];
    let (mut miny, mut maxy) = (0usize, 0usize);
    for i in 1..total {
        let y = y_of(i);
        if y_of(miny) > y {
            miny = i;
        }
        if y_of(maxy) < y {
            maxy = i;
        }
    }
    if pts.same(order[0], order[total - 1]) {
        return vec![0];
    }

    let mut stack = vec![0isize; 2 * total + 8];
    let mut hull: Vec<isize> = Vec::with_capacity(total);
    let last = total as isize - 1;
    // upper half (clockwise = false swaps the two stacks)
    let tl_count = sklansky(pts, &order, 0, maxy as isize, &mut stack, 0, -1, 1);
    let tr_base = tl_count;
    let tr_count = sklansky(
        pts,
        &order,
        last,
        maxy as isize,
        &mut stack,
        tr_base,
        -1,
        -1,
    );
    let (tl_base, tl_count, tr_base, tr_count) = (tr_base, tr_count, 0usize, tl_count);
    for i in 0..tl_count.saturating_sub(1) {
        hull.push(stack[tl_base + i]);
    }
    for i in (1..tr_count).rev() {
        hull.push(stack[tr_base + i]);
    }
    let stop_idx: isize = if tr_count > 2 {
        stack[tr_base + 1]
    } else if tl_count > 2 {
        stack[tl_base + tl_count - 2]
    } else {
        -1
    };
    // lower half
    let bl_base = 0usize;
    let mut bl_count = sklansky(pts, &order, 0, miny as isize, &mut stack, bl_base, 1, -1);
    let br_base = bl_count;
    let mut br_count = sklansky(pts, &order, last, miny as isize, &mut stack, br_base, 1, 1);
    if stop_idx >= 0 {
        let check_idx: isize = if bl_count > 2 {
            stack[bl_base + 1]
        } else if bl_count + br_count > 2 {
            stack[br_base + 2 - bl_count]
        } else {
            -1
        };
        if check_idx == stop_idx
            || (check_idx >= 0 && pts.same(order[check_idx as usize], order[stop_idx as usize]))
        {
            bl_count = bl_count.min(2);
            br_count = br_count.min(2);
        }
    }
    for i in 0..bl_count.saturating_sub(1) {
        hull.push(stack[bl_base + i]);
    }
    for i in (1..br_count).rev() {
        hull.push(stack[br_base + i]);
    }
    let mut hull: Vec<usize> = hull.into_iter().map(|i| order[i as usize]).collect();

    // Cyclic shift towards an ascending or descending index sequence.
    let nout = hull.len();
    if nout >= 3 {
        let (mut min_idx, mut max_idx, mut lt) = (0usize, 0usize, 0usize);
        for i in 1..nout {
            let idx = hull[i];
            lt += (hull[i - 1] < idx) as usize;
            if lt > 1 && lt + 2 <= i {
                break;
            }
            if idx < hull[min_idx] {
                min_idx = i;
            }
            if idx > hull[max_idx] {
                max_idx = i;
            }
        }
        let mmdist = min_idx.abs_diff(max_idx);
        if (mmdist == 1 || mmdist == nout - 1) && (lt <= 1 || lt + 2 >= nout) {
            let ascending = (max_idx + 1) % nout == min_idx;
            let i0 = if ascending { min_idx } else { max_idx };
            if i0 > 0 {
                let mut shifted = Vec::with_capacity(nout);
                let mut j = i0;
                let mut complete = true;
                for i in 0..nout {
                    let curr = hull[j];
                    shifted.push(curr);
                    let next_j = if j + 1 < nout { j + 1 } else { 0 };
                    let next = hull[next_j];
                    if i < nout - 1 && (ascending != (curr < next)) {
                        complete = false;
                        break;
                    }
                    j = next_j;
                }
                if complete {
                    hull = shifted;
                }
            }
        }
    }
    hull
}

fn rotate90_cw(v: [f32; 2]) -> [f32; 2] {
    [v[1], -v[0]]
}

fn first_vec_is_right(v1: [f32; 2], v2: [f32; 2]) -> bool {
    let t = rotate90_cw(v1);
    t[0] * v2[0] + t[1] * v2[1] < 0.0
}

/// `rotatingCalipers(points, n, orientation=1, CALIPERS_MINAREARECT)`.
fn rotating_calipers(p: &[[f32; 2]]) -> [[f32; 2]; 3] {
    let n = p.len();
    let mut minarea = f32::MAX;
    let mut inv_len = vec![0f32; n];
    let mut vect = vec![[0f32; 2]; n];
    let (mut left, mut bottom, mut right, mut top) = (0usize, 0usize, 0usize, 0usize);
    let mut pt0 = p[0];
    let (mut left_x, mut right_x, mut top_y, mut bottom_y) = (pt0[0], pt0[0], pt0[1], pt0[1]);
    for i in 0..n {
        if pt0[0] < left_x {
            left_x = pt0[0];
            left = i;
        }
        if pt0[0] > right_x {
            right_x = pt0[0];
            right = i;
        }
        if pt0[1] > top_y {
            top_y = pt0[1];
            top = i;
        }
        if pt0[1] < bottom_y {
            bottom_y = pt0[1];
            bottom = i;
        }
        let pt = p[if i + 1 < n { i + 1 } else { 0 }];
        let dx = (pt[0] - pt0[0]) as f64;
        let dy = (pt[1] - pt0[1]) as f64;
        vect[i] = [dx as f32, dy as f32];
        inv_len[i] = (1.0 / (dx * dx + dy * dy).sqrt()) as f32;
        pt0 = pt;
    }
    let mut seq = [bottom, right, top, left];
    let mut buf_idx = [0usize; 2];
    let mut buf = [0f32; 4]; // base_a, width, base_b, height
    for _ in 0..n {
        let rot = [
            vect[seq[0]],
            rotate90_cw(vect[seq[1]]),
            [-vect[seq[2]][0], -vect[seq[2]][1]],
            [-vect[seq[3]][1], vect[seq[3]][0]],
        ];
        let mut main = 0usize;
        for i in 1..4 {
            if first_vec_is_right(rot[i], rot[main]) {
                main = i;
            }
        }
        let pindex = seq[main];
        let lead_x = vect[pindex][0] * inv_len[pindex];
        let lead_y = vect[pindex][1] * inv_len[pindex];
        let (base_a, base_b) = match main {
            0 => (lead_x, lead_y),
            1 => (lead_y, -lead_x),
            2 => (-lead_x, -lead_y),
            _ => (-lead_y, lead_x),
        };
        seq[main] += 1;
        if seq[main] == n {
            seq[main] = 0;
        }
        let dx = p[seq[1]][0] - p[seq[3]][0];
        let dy = p[seq[1]][1] - p[seq[3]][1];
        let width = dx * base_a + dy * base_b;
        let dx = p[seq[2]][0] - p[seq[0]][0];
        let dy = p[seq[2]][1] - p[seq[0]][1];
        let height = -dx * base_b + dy * base_a;
        let area = width * height;
        if area <= minarea {
            minarea = area;
            buf_idx = [seq[3], seq[0]];
            buf = [base_a, width, base_b, height];
        }
    }
    let (a1, b1) = (buf[0], buf[2]);
    let (a2, b2) = (-buf[2], buf[0]);
    let l = p[buf_idx[0]];
    let b = p[buf_idx[1]];
    let c1 = a1 * l[0] + l[1] * b1;
    let c2 = a2 * b[0] + b[1] * b2;
    let idet = 1.0f32 / (a1 * b2 - a2 * b1);
    let px = (c1 * b2 - c2 * b1) * idet;
    let py = (a1 * c2 - a2 * c1) * idet;
    [
        [px, py],
        [a1 * buf[1], b1 * buf[1]],
        [a2 * buf[3], b2 * buf[3]],
    ]
}

/// `cv::minAreaRect`.
pub fn min_area_rect(pts: &Pts) -> RotatedRect {
    let hull: Vec<[f32; 2]> = convex_hull(pts).into_iter().map(|i| pts.get(i)).collect();
    let n = hull.len();
    let mut angle = -PI / 2.0;
    let mut r = RotatedRect {
        center: [0.0, 0.0],
        size: [0.0, 0.0],
        angle: 0.0,
    };
    if n > 2 {
        let out = rotating_calipers(&hull);
        r.center = [
            out[0][0] + (out[1][0] + out[2][0]) * 0.5,
            out[0][1] + (out[1][1] + out[2][1]) * 0.5,
        ];
        let len =
            |v: [f32; 2]| ((v[0] as f64) * v[0] as f64 + (v[1] as f64) * v[1] as f64).sqrt() as f32;
        r.size = [len(out[2]), len(out[1])];
        if out[1][0] == 0.0 && out[1][1] > 0.0 {
            r.size.swap(0, 1);
        } else {
            angle = -(out[1][0] as f64).atan2(out[1][1] as f64);
        }
    } else if n == 2 {
        r.center = [
            (hull[0][0] + hull[1][0]) * 0.5,
            (hull[0][1] + hull[1][1]) * 0.5,
        ];
        let dx = (hull[0][0] - hull[1][0]) as f64;
        let dy = (hull[0][1] - hull[1][1]) as f64;
        r.size = [0.0, (dx * dx + dy * dy).sqrt() as f32];
        if dx == 0.0 {
            r.size.swap(0, 1);
        } else if dy < 0.0 {
            angle = dy.atan2(dx);
            r.size.swap(0, 1);
        } else if dy > 0.0 {
            angle = -dx.atan2(dy);
        }
    } else if n == 1 {
        r.center = hull[0];
    }
    r.angle = (angle * 180.0 / PI) as f32;
    r
}

/// `cv2.boxPoints` (`RotatedRect::points`).
pub fn box_points(r: &RotatedRect) -> [[f32; 2]; 4] {
    let a = r.angle as f64 * PI / 180.0;
    let b = (a.cos() as f32) * 0.5;
    let a = (a.sin() as f32) * 0.5;
    let [cx, cy] = r.center;
    let [w, h] = r.size;
    let (ah, aw, bh, bw) = (a * h, a * w, b * h, b * w);
    [
        [cx - ah - bw, cy + bh - aw],
        [cx + ah - bw, cy - bh - aw],
        [cx + ah + bw, cy - bh + aw],
        [cx - ah + bw, cy + bh + aw],
    ]
}

/// PaddleOCR's `get_mini_boxes`: the min-area rectangle as TL, TR, BR, BL
/// and its shorter side.
pub fn get_mini_boxes(pts: &Pts) -> ([[f32; 2]; 4], f32) {
    let r = min_area_rect(pts);
    let mut p = box_points(&r);
    // Python's sorted() is stable.
    p.sort_by(|a, b| a[0].partial_cmp(&b[0]).unwrap_or(std::cmp::Ordering::Equal));
    let (i1, i4) = if p[1][1] > p[0][1] { (0, 1) } else { (1, 0) };
    let (i2, i3) = if p[3][1] > p[2][1] { (2, 3) } else { (3, 2) };
    ([p[i1], p[i2], p[i3], p[i4]], r.size[0].min(r.size[1]))
}
