//! `hdbscan.HDBSCAN(metric="euclidean").fit(X).labels_` as hdbscan 0.8.44
//! runs it for face encodings (more than 60 features, so `prims_kdtree`):
//! core distances, Prim's MST on the mutual reachability graph, single
//! linkage, condensed tree, excess-of-mass selection with the
//! `cluster_selection_epsilon` search, labelling. Defaults as face_classify
//! leaves them: `alpha=1.0`, `cluster_selection_method="eom"`,
//! `allow_single_cluster=False`, no persistence, no max cluster size.
//!
//! Distances are summed feature by feature like the Cython `euclidean_dist`,
//! so they are bit-identical and the MST is the same tree; only ties between
//! equal MST edge weights may be ordered differently (numpy's unstable
//! argsort vs a stable sort here). The O(n²) scans run on reduced copies
//! (f32 for the core distances, i8 for Prim's n passes over the data, a
//! quarter of the f32 traffic) and compute the exact f64 distance only for
//! the rows the reduced value, with its error bound, cannot rule out.

use std::collections::{HashMap, HashSet};

use rayon::prelude::*;

/// Rows per interleaved block: lane `l` of a block holds row `8k + l`, so
/// eight distances are summed side by side.
const LANES: usize = 8;
/// A Prim iteration may go parallel from this many features scanned (16k
/// rows of 512): below, waking the workers for every one of the n steps
/// costs more than it saves (see [`Pace`] above it).
const PARALLEL_WORK: usize = 1 << 23;
/// Core distances: query rows per task, per register tile, blocks per panel.
const QUERY_ROWS: usize = 64;
const TILE: usize = 4;
const PANEL_BLOCKS: usize = 32;
/// The scans run on f32 copies; `|s32 - s| <= slack * (|a|² + |b|²)` bounds
/// the error of an f32 squared distance (input, difference, square and
/// d-term sum roundings stay below `d * 1.2e-7` of it: 6.2e-5 for 512
/// features), so a row is only passed over when its exact distance cannot
/// matter. The slack is this floor or three times that bound.
const F32_SLACK: f64 = 2e-4;

fn f32_slack(d: usize) -> f64 {
    F32_SLACK.max(3.0 * 1.2e-7 * d as f64)
}

#[derive(Debug, Clone, Copy)]
pub struct Params {
    pub min_cluster_size: i64,
    pub min_samples: i64,
    pub cluster_selection_epsilon: f64,
}

/// Cluster labels (`-1` noise) of the `n` rows of `data` (row-major, `d`
/// features each). Errors carry the Python exception text.
pub fn labels(data: &[f64], d: usize, p: &Params) -> Result<Vec<i64>, String> {
    let n = data.len().checked_div(d).unwrap_or(0);
    if p.min_samples <= 0 || p.min_cluster_size <= 0 {
        return Err("Min samples and Min cluster size must be positive integers".into());
    }
    if p.min_cluster_size == 1 {
        return Err("Min cluster size must be greater than one".into());
    }
    if p.cluster_selection_epsilon.is_nan() || p.cluster_selection_epsilon < 0.0 {
        return Err("Epsilon must be a float value greater than or equal to 0!".into());
    }
    if n == 0 {
        return Ok(Vec::new());
    }
    // `HDBSCAN.fit` clusters the finite rows only; the others are noise.
    let finite: Vec<usize> = (0..n)
        .filter(|i| data[i * d..(i + 1) * d].iter().all(|v| v.is_finite()))
        .collect();
    if finite.len() < n {
        if finite.is_empty() {
            return Err(format!(
                "Found array with 0 sample(s) (shape=(0, {d})) while a minimum of 1 is required."
            ));
        }
        let clean: Vec<f64> = finite
            .iter()
            .flat_map(|i| data[i * d..(i + 1) * d].iter().copied())
            .collect();
        let inner = labels(&clean, d, p)?;
        let mut out = vec![-1; n];
        for (i, label) in finite.into_iter().zip(inner) {
            out[i] = label;
        }
        return Ok(out);
    }
    let min_samples = (p.min_samples as usize).min(n - 1).max(1);
    if min_samples + 1 > n {
        return Err("k must be less than or equal to the number of training points".into());
    }
    let t = std::time::Instant::now();
    // Inside the pool: Prim's n short parallel steps would otherwise each
    // wait for sleeping workers to be woken from outside.
    let mut mst = rayon::scope(|_| {
        let rows32 = Rows32::new(data, d);
        let blocks = Blocked::new(&rows32, &(0..n as u32).collect::<Vec<_>>());
        let core = core_distances(data, &rows32, &blocks, min_samples + 1);
        drop((blocks, rows32));
        tracing::debug!(n, elapsed = ?t.elapsed(), "hdbscan: core distances");
        prim_mst(data, &Quant::new(data, d), &core)
    });
    tracing::debug!(n, elapsed = ?t.elapsed(), "hdbscan: minimum spanning tree");
    // `np.argsort(mst.T[2])`; equal weights keep Prim's order.
    mst.sort_by(|a, b| a.2.total_cmp(&b.2));
    let hierarchy = single_linkage(&mst, n);
    let tree = condense_tree(&hierarchy, n, p.min_cluster_size as usize);
    Ok(get_clusters(&tree, p.cluster_selection_epsilon))
}

/// Exact squared distance, summed in feature order like the Cython
/// `euclidean_dist` / sklearn's `euclidean_rdist` (`tmp += (x1[j] - x2[j])**2`).
#[inline]
fn rdist(a: &[f64], b: &[f64]) -> f64 {
    let mut s = 0.0;
    for (x, y) in a.iter().zip(b) {
        let t = x - y;
        s += t * t;
    }
    s
}

/// The f32 copy the scans run on (row-major, for the queries) and each
/// row's squared norm for the f32 error bound.
struct Rows32 {
    d: usize,
    slack: f64,
    data: Vec<f32>,
    norms: Vec<f64>,
}

impl Rows32 {
    fn new(data: &[f64], d: usize) -> Rows32 {
        Rows32 {
            d,
            slack: f32_slack(d),
            data: data.iter().map(|v| *v as f32).collect(),
            norms: data
                .chunks(d)
                .map(|r| r.iter().map(|v| v * v).sum())
                .collect(),
        }
    }

    fn row(&self, i: usize) -> &[f32] {
        &self.data[i * self.d..(i + 1) * self.d]
    }

    /// Whether the exact squared distance of rows `i` and `j` is surely
    /// above `bound`, judging from their f32 squared distance `s32`.
    #[inline]
    fn surely_above(&self, s32: f32, i: usize, j: usize, bound: f64) -> bool {
        s32 as f64 - self.slack * (self.norms[i] + self.norms[j]) > bound
    }
}

/// Rows (f32) in blocks of [`LANES`] interleaved rows, padded with the last
/// row, so the inner distance loop runs over contiguous lanes.
struct Blocked {
    d: usize,
    rows: Vec<u32>,
    data: Vec<f32>,
}

impl Blocked {
    fn new(rows32: &Rows32, rows: &[u32]) -> Blocked {
        let d = rows32.d;
        let nb = rows.len().div_ceil(LANES);
        let mut out = vec![0.0f32; nb * d * LANES];
        out.par_chunks_mut(d * LANES)
            .enumerate()
            .for_each(|(b, chunk)| {
                for l in 0..LANES {
                    let r = rows[(b * LANES + l).min(rows.len() - 1)] as usize;
                    for (f, v) in rows32.row(r).iter().enumerate() {
                        chunk[f * LANES + l] = *v;
                    }
                }
            });
        Blocked {
            d,
            rows: rows.to_vec(),
            data: out,
        }
    }

    fn blocks(&self) -> usize {
        self.data.len() / (self.d * LANES)
    }

    fn block(&self, b: usize) -> &[f32] {
        &self.data[b * self.d * LANES..(b + 1) * self.d * LANES]
    }

    /// f32 squared distances of [`TILE`] query rows to the rows of block `b`.
    #[inline]
    fn sq_tile(&self, q: [&[f32]; TILE], b: usize) -> [[f32; LANES]; TILE] {
        let mut acc = [[0.0f32; LANES]; TILE];
        let rows = q[0].iter().zip(q[1]).zip(q[2]).zip(q[3]);
        for ((((a0, a1), a2), a3), lanes) in rows.zip(self.block(b).chunks_exact(LANES)) {
            for (t, av) in [a0, a1, a2, a3].into_iter().enumerate() {
                for l in 0..LANES {
                    let x = lanes[l] - av;
                    acc[t][l] += x * x;
                }
            }
        }
        acc
    }
}

/// `KDTree.query(X, k)[0][:, -1]`: distance to the k-th nearest row, the
/// row itself included. Each task takes [`QUERY_ROWS`] rows and walks the
/// blocks panel by panel, so a panel is read from memory once per task;
/// only the rows the f32 scan cannot rule out get their exact distance.
fn core_distances(data: &[f64], rows32: &Rows32, blocks: &Blocked, k: usize) -> Vec<f64> {
    let d = rows32.d;
    let n = blocks.rows.len();
    let tasks: Vec<usize> = (0..n).step_by(QUERY_ROWS).collect();
    let per_task: Vec<Vec<f64>> = tasks
        .into_par_iter()
        .map(|start| {
            let end = (start + QUERY_ROWS).min(n);
            // The k smallest exact squared distances of each row, ascending.
            let mut best: Vec<Vec<f64>> = vec![Vec::with_capacity(k + 1); end - start];
            let nb = blocks.blocks();
            for panel in (0..nb).step_by(PANEL_BLOCKS) {
                for q0 in (start..end).step_by(TILE) {
                    let q = [0, 1, 2, 3].map(|t| rows32.row((q0 + t).min(end - 1)));
                    for b in panel..(panel + PANEL_BLOCKS).min(nb) {
                        let r = blocks.sq_tile(q, b);
                        for (t, s32) in r.iter().enumerate() {
                            let i = q0 + t;
                            if i >= end {
                                break;
                            }
                            let best = &mut best[i - start];
                            for (l, s) in s32.iter().enumerate() {
                                let j = b * LANES + l;
                                if j >= n {
                                    break;
                                }
                                if best.len() == k && rows32.surely_above(*s, i, j, best[k - 1]) {
                                    continue;
                                }
                                let v = rdist(&data[i * d..(i + 1) * d], &data[j * d..(j + 1) * d]);
                                if best.len() == k && v >= best[k - 1] {
                                    continue;
                                }
                                let pos = best.partition_point(|x| *x <= v);
                                best.insert(pos, v);
                                best.truncate(k);
                            }
                        }
                    }
                }
            }
            best.into_iter().map(|b| b[k - 1].sqrt()).collect()
        })
        .collect();
    per_task.concat()
}

/// The rows quantized to i8 (`x ≈ scale · q`) for Prim's scans, with what
/// the error bound needs: each row's exact squared norm, norm and residual
/// norm `|x - scale · q|`.
struct Quant {
    d: usize,
    q: Vec<i8>,
    scale: Vec<f64>,
    norm2: Vec<f64>,
    norm: Vec<f64>,
    err: Vec<f64>,
}

impl Quant {
    fn new(data: &[f64], d: usize) -> Quant {
        let n = data.len() / d;
        let mut q = vec![0i8; n * d];
        let rows: Vec<(f64, f64, f64)> = q
            .par_chunks_mut(d)
            .zip(data.par_chunks(d))
            .map(|(qr, x)| {
                let max = x.iter().fold(0.0f64, |m, v| m.max(v.abs()));
                let scale = if max > 0.0 && max.is_finite() {
                    max / 127.0
                } else {
                    1.0
                };
                let mut err2 = 0.0;
                for (qv, v) in qr.iter_mut().zip(x) {
                    let r = (v / scale).round().clamp(-127.0, 127.0);
                    *qv = r as i8;
                    let e = v - scale * r;
                    err2 += e * e;
                }
                let norm2: f64 = x.iter().map(|v| v * v).sum();
                (scale, norm2, err2.sqrt())
            })
            .collect();
        Quant {
            d,
            q,
            scale: rows.iter().map(|r| r.0).collect(),
            norm2: rows.iter().map(|r| r.1).collect(),
            norm: rows.iter().map(|r| r.1.sqrt()).collect(),
            err: rows.iter().map(|r| r.2).collect(),
        }
    }

    fn row(&self, i: usize) -> &[i8] {
        &self.q[i * self.d..(i + 1) * self.d]
    }

    /// Whether the exact squared distance of rows `i` and `j` is surely
    /// above `bound`, from `|a|² + |b|² - 2 sa sb (qa·qb)`: the dot product
    /// of the quantized rows misses `a·b` by at most
    /// `(|a| + ea) eb + ea |b|`. The relative 1e-9 covers f64 rounding.
    #[inline]
    fn surely_above(&self, dot: i32, i: usize, j: usize, bound: f64) -> bool {
        let n2 = self.norm2[i] + self.norm2[j];
        let est = n2 - 2.0 * self.scale[i] * self.scale[j] * dot as f64;
        let slack = 2.0 * ((self.norm[i] + self.err[i]) * self.err[j] + self.err[i] * self.norm[j])
            + 1e-9 * n2;
        est - slack > bound * (1.0 + 1e-9)
    }
}

/// Integer dot product of two quantized rows (exact in any order).
#[inline]
fn dot_i8(a: &[i8], b: &[i8]) -> i32 {
    let mut acc = [0i32; 16];
    let (a16, a_rest) = a.split_at(a.len() / 16 * 16);
    let (b16, b_rest) = b.split_at(a16.len());
    for (x, y) in a16.chunks_exact(16).zip(b16.chunks_exact(16)) {
        for k in 0..16 {
            acc[k] += (x[k] as i16 * y[k] as i16) as i32;
        }
    }
    let mut s: i32 = acc.iter().sum();
    for (x, y) in a_rest.iter().zip(b_rest) {
        s += (*x as i16 * *y as i16) as i32;
    }
    s
}

/// `mst_linkage_core_vector` (alpha 1): Prim's algorithm on the mutual
/// reachability distance, `(source, new_node, distance)` in the order the
/// nodes join the tree. The next node is the first (lowest index) one at the
/// smallest distance, as in the sequential Cython loop.
fn prim_mst(data: &[f64], quant: &Quant, core: &[f64]) -> Vec<(usize, usize, f64)> {
    let n = core.len();
    let d = quant.d;
    let mut result = Vec::with_capacity(n.saturating_sub(1));
    if n < 2 {
        return result;
    }
    // The rows not yet in the tree (node 0 joins first): their index, a
    // contiguous copy of their quantized row, current distance and source.
    // Rebuilt without the stale entries once half of them joined the tree.
    let mut rows: Vec<u32> = (1..n as u32).collect();
    let mut q: Vec<i8> = quant.q[d..].to_vec();
    let mut state: Vec<Lane> = vec![
        Lane {
            dist: f64::INFINITY,
            source: 1,
            live: true,
        };
        n - 1
    ];
    let mut live_count = n - 1;
    let mut current = 0usize;
    let mut pace = Pace::default();

    while live_count > 0 {
        let step = Step {
            data,
            quant,
            a: &data[current * d..(current + 1) * d],
            qa: quant.row(current),
            core,
            core_cur: core[current],
            current,
        };
        let chunk = PRIM_CHUNK;
        let parallel = state.len() * d >= PARALLEL_WORK && pace.parallel(result.len());
        let started = std::time::Instant::now();
        let best = if !parallel {
            state
                .chunks_mut(chunk)
                .zip(q.chunks(chunk * d))
                .zip(rows.chunks(chunk))
                .enumerate()
                .map(|(c, ((lanes, qs), rs))| step.run(c * chunk, lanes, qs, rs))
                .fold(Best::NONE, Best::min)
        } else {
            state
                .par_chunks_mut(chunk)
                .zip(q.par_chunks(chunk * d))
                .zip(rows.par_chunks(chunk))
                .enumerate()
                .map(|(c, ((lanes, qs), rs))| step.run(c * chunk, lanes, qs, rs))
                .reduce(|| Best::NONE, Best::min)
        };
        if state.len() * d >= PARALLEL_WORK {
            pace.record(
                parallel,
                started.elapsed().as_secs_f64() / state.len() as f64,
            );
        }
        // Starting from DBL_MAX, the Cython loop keeps node 0 (source 0)
        // when nothing is closer; only non-finite data gets here.
        let Some(pos) = best.pos else {
            result.push((0, 0, f64::MAX));
            break;
        };
        let lane = &mut state[pos];
        result.push((lane.source, best.node, best.value));
        lane.live = false;
        live_count -= 1;
        current = best.node;
        if result.len() % 5_000 == 0 {
            tracing::debug!(joined = result.len(), of = n, "hdbscan: prim");
        }

        if live_count * 2 < state.len() && state.len() > 64 {
            let keep: Vec<usize> = (0..state.len()).filter(|i| state[*i].live).collect();
            q = keep
                .iter()
                .flat_map(|i| q[i * d..(i + 1) * d].iter().copied())
                .collect();
            rows = keep.iter().map(|i| rows[*i]).collect();
            state = keep.iter().map(|i| state[*i]).collect();
        }
    }
    result
}

/// Rows per chunk (and rayon task) of a Prim iteration.
const PRIM_CHUNK: usize = 1024;

/// Whether a big Prim iteration runs in parallel. Each of the n iterations
/// is a fork-join; on a busy machine a preempted worker stalls it for a
/// scheduler quantum and one thread is faster. Every 64 iterations the
/// other mode is timed again; the one with the lower time per row wins.
#[derive(Default)]
struct Pace {
    seq: Option<f64>,
    par: Option<f64>,
}

impl Pace {
    fn parallel(&self, iteration: usize) -> bool {
        match (self.seq, self.par) {
            (_, None) => true,
            (None, _) => false,
            (Some(s), Some(p)) => {
                let explore = iteration.is_multiple_of(64);
                (p <= s) != explore
            }
        }
    }

    fn record(&mut self, parallel: bool, per_row: f64) {
        let slot = if parallel {
            &mut self.par
        } else {
            &mut self.seq
        };
        *slot = Some(slot.map_or(per_row, |old| 0.7 * old + 0.3 * per_row));
    }
}

#[derive(Debug, Clone, Copy)]
struct Lane {
    dist: f64,
    source: usize,
    live: bool,
}

#[derive(Debug, Clone, Copy)]
struct Best {
    value: f64,
    node: usize,
    pos: Option<usize>,
}

impl Best {
    const NONE: Best = Best {
        value: f64::MAX,
        node: usize::MAX,
        pos: None,
    };

    fn min(self, other: Best) -> Best {
        if other.pos.is_some()
            && (self.pos.is_none()
                || other.value < self.value
                || (other.value == self.value && other.node < self.node))
        {
            other
        } else {
            self
        }
    }
}

/// One Prim iteration from `current`.
struct Step<'a> {
    data: &'a [f64],
    quant: &'a Quant,
    a: &'a [f64],
    qa: &'a [i8],
    core: &'a [f64],
    core_cur: f64,
    current: usize,
}

impl Step<'_> {
    /// The Cython inner loop over one chunk of rows (positions from
    /// `base`). The exact distance is only needed when it might be below
    /// the row's current one: a farther row keeps its distance whatever the
    /// exact value is.
    fn run(&self, base: usize, lanes: &mut [Lane], qs: &[i8], rows: &[u32]) -> Best {
        let d = self.a.len();
        let mut best = Best::NONE;
        for (l, (lane, row)) in lanes.iter_mut().zip(rows).enumerate() {
            if !lane.live {
                continue;
            }
            let j = *row as usize;
            let right = lane.dist;
            let core_j = self.core[j];
            let value = if self.core_cur > right
                || core_j > right
                || self.quant.surely_above(
                    dot_i8(self.qa, &qs[l * d..(l + 1) * d]),
                    self.current,
                    j,
                    right * right,
                ) {
                right
            } else {
                let left = rdist(self.a, &self.data[j * d..(j + 1) * d]).sqrt();
                if left > right {
                    right
                } else {
                    let mr = if core_j > self.core_cur {
                        if core_j > left { core_j } else { left }
                    } else if self.core_cur > left {
                        self.core_cur
                    } else {
                        left
                    };
                    if mr < right {
                        lane.dist = mr;
                        lane.source = self.current;
                        mr
                    } else {
                        right
                    }
                }
            };
            // Strictly below DBL_MAX, like `if value < new_distance`.
            if value < f64::MAX {
                best = best.min(Best {
                    value,
                    node: j,
                    pos: Some(base + l),
                });
            }
        }
        best
    }
}

/// A single-linkage row: children, distance, size (scipy hclust format).
#[derive(Debug, Clone, Copy)]
struct Link {
    left: usize,
    right: usize,
    delta: f64,
    size: usize,
}

/// `_hdbscan_linkage.label`: sorted MST edges to a scipy-style hierarchy.
fn single_linkage(mst: &[(usize, usize, f64)], n: usize) -> Vec<Link> {
    let mut parent = vec![usize::MAX; 2 * n - 1];
    let mut size: Vec<usize> = (0..2 * n - 1).map(|i| usize::from(i < n)).collect();
    let mut next = n;
    let find = |parent: &mut [usize], mut x: usize| {
        let mut p = x;
        while parent[x] != usize::MAX {
            x = parent[x];
        }
        while parent[p] != x && parent[p] != usize::MAX {
            let up = parent[p];
            parent[p] = x;
            p = up;
        }
        x
    };
    let mut out = Vec::with_capacity(mst.len());
    for &(a, b, delta) in mst {
        let aa = find(&mut parent, a);
        let bb = find(&mut parent, b);
        let s = size[aa] + size[bb];
        out.push(Link {
            left: aa,
            right: bb,
            delta,
            size: s,
        });
        size[next] = s;
        parent[aa] = next;
        parent[bb] = next;
        next += 1;
    }
    out
}

/// A condensed-tree row.
#[derive(Debug, Clone, Copy)]
struct Condensed {
    parent: usize,
    child: usize,
    lambda: f64,
    child_size: usize,
}

/// `bfs_from_hierarchy`: `root` and its descendants, level by level.
fn bfs_hierarchy(h: &[Link], root: usize, n: usize) -> Vec<usize> {
    let mut result = Vec::new();
    let mut level = vec![root];
    while !level.is_empty() {
        result.extend_from_slice(&level);
        let mut next = Vec::new();
        for &x in &level {
            if x >= n {
                let row = &h[x - n];
                next.push(row.left);
                next.push(row.right);
            }
        }
        level = next;
    }
    result
}

/// `condense_tree`.
fn condense_tree(h: &[Link], n: usize, min_cluster_size: usize) -> Vec<Condensed> {
    let root = 2 * h.len();
    let mut next_label = n + 1;
    let node_list = bfs_hierarchy(h, root, n);
    let mut relabel = vec![0usize; root + 1];
    relabel[root] = n;
    let mut ignore = vec![false; root + 1];
    let mut out = Vec::with_capacity(2 * n);
    let count = |node: usize| if node >= n { h[node - n].size } else { 1 };

    for node in node_list {
        if ignore[node] || node < n {
            continue;
        }
        let row = h[node - n];
        let (left, right) = (row.left, row.right);
        let lambda = if row.delta > 0.0 {
            1.0 / row.delta
        } else {
            f64::INFINITY
        };
        let (lc, rc) = (count(left), count(right));
        let parent = relabel[node];
        let drop_points = |sub: usize, out: &mut Vec<Condensed>, ignore: &mut [bool]| {
            for s in bfs_hierarchy(h, sub, n) {
                if s < n {
                    out.push(Condensed {
                        parent,
                        child: s,
                        lambda,
                        child_size: 1,
                    });
                }
                ignore[s] = true;
            }
        };
        if lc >= min_cluster_size && rc >= min_cluster_size {
            relabel[left] = next_label;
            next_label += 1;
            out.push(Condensed {
                parent,
                child: relabel[left],
                lambda,
                child_size: lc,
            });
            relabel[right] = next_label;
            next_label += 1;
            out.push(Condensed {
                parent,
                child: relabel[right],
                lambda,
                child_size: rc,
            });
        } else if lc < min_cluster_size && rc < min_cluster_size {
            drop_points(left, &mut out, &mut ignore);
            drop_points(right, &mut out, &mut ignore);
        } else if lc < min_cluster_size {
            relabel[right] = parent;
            drop_points(left, &mut out, &mut ignore);
        } else {
            relabel[left] = parent;
            drop_points(right, &mut out, &mut ignore);
        }
    }
    out
}

/// `compute_stability`: cluster id -> stability, for ids from the root to
/// the largest parent.
fn compute_stability(tree: &[Condensed]) -> (usize, Vec<f64>) {
    let smallest = tree.iter().map(|r| r.parent).min().unwrap_or(0);
    let largest_parent = tree.iter().map(|r| r.parent).max().unwrap_or(0);
    let largest_child = tree
        .iter()
        .map(|r| r.child)
        .max()
        .unwrap_or(0)
        .max(smallest);
    let mut births = vec![f64::NAN; largest_child + 1];
    for r in tree {
        let b = &mut births[r.child];
        // np.sort puts NaN last; min over one row per child is its lambda.
        if b.is_nan() || r.lambda < *b {
            *b = r.lambda;
        }
    }
    births[smallest] = 0.0;
    let mut result = vec![0.0f64; largest_parent - smallest + 1];
    for r in tree {
        result[r.parent - smallest] += (r.lambda - births[r.parent]) * r.child_size as f64;
    }
    (smallest, result)
}

/// `get_clusters(..., "eom", allow_single_cluster=False, epsilon)` and
/// `do_labelling`: the labels only.
fn get_clusters(tree: &[Condensed], epsilon: f64) -> Vec<i64> {
    let (smallest, mut stability) = compute_stability(tree);
    let largest = smallest + stability.len() - 1;
    // `sorted(stability.keys(), reverse=True)[:-1]`: every cluster but the root.
    let node_list: Vec<usize> = (smallest + 1..=largest).rev().collect();
    let cluster_rows: Vec<&Condensed> = tree.iter().filter(|r| r.child_size > 1).collect();
    let mut children: HashMap<usize, Vec<usize>> = HashMap::new();
    let mut child_lookup: HashMap<usize, (usize, f64)> = HashMap::new();
    for r in &cluster_rows {
        children.entry(r.parent).or_default().push(r.child);
        child_lookup.insert(r.child, (r.parent, r.lambda));
    }
    let ct_root = cluster_rows.iter().map(|r| r.parent).min().unwrap_or(0);
    let bfs = |root: usize| {
        let mut out = Vec::new();
        let mut level = vec![root];
        while !level.is_empty() {
            out.extend_from_slice(&level);
            let mut next = Vec::new();
            for x in &level {
                if let Some(c) = children.get(x) {
                    next.extend_from_slice(c);
                }
            }
            level = next;
        }
        out
    };

    let mut is_cluster: HashMap<usize, bool> = node_list.iter().map(|c| (*c, true)).collect();
    let stab = |s: &Vec<f64>, id: usize| s.get(id - smallest).copied().unwrap_or(f64::NAN);
    for &node in &node_list {
        // `cdef float subtree_stability`: each sum is rounded to f32.
        let mut subtree: f32 = 0.0;
        for ch in children.get(&node).map(Vec::as_slice).unwrap_or(&[]) {
            subtree = (subtree as f64 + stab(&stability, *ch)) as f32;
        }
        if subtree as f64 > stab(&stability, node) {
            is_cluster.insert(node, false);
            stability[node - smallest] = subtree as f64;
        } else {
            for sub in bfs(node) {
                if sub != node {
                    is_cluster.insert(sub, false);
                }
            }
        }
    }

    if epsilon != 0.0 && !cluster_rows.is_empty() {
        let eom: Vec<usize> = node_list
            .iter()
            .copied()
            .filter(|c| is_cluster[c])
            .collect();
        let selected = if eom.len() == 1 && eom[0] == ct_root {
            HashSet::new()
        } else {
            epsilon_search(&eom, &child_lookup, &bfs, epsilon, ct_root)
        };
        for c in &node_list {
            is_cluster.insert(*c, selected.contains(c));
        }
    }

    let mut clusters: Vec<usize> = node_list
        .iter()
        .copied()
        .filter(|c| is_cluster[c])
        .collect();
    clusters.sort_unstable();
    let label_of: HashMap<usize, i64> = clusters
        .iter()
        .enumerate()
        .map(|(i, c)| (*c, i as i64))
        .collect();
    do_labelling(tree, &label_of)
}

/// `_epsilon_search_fast` (allow_single_cluster False). The order leaves
/// are visited in does not change the result: both children of a split share
/// its lambda, so every leaf under a selected ancestor climbs to it.
fn epsilon_search(
    leaves: &[usize],
    child_lookup: &HashMap<usize, (usize, f64)>,
    bfs: &dyn Fn(usize) -> Vec<usize>,
    epsilon: f64,
    root: usize,
) -> HashSet<usize> {
    let mut selected = HashSet::new();
    let mut processed = HashSet::new();
    for &leaf in leaves {
        let eps = 1.0 / child_lookup[&leaf].1;
        if eps < epsilon {
            if !processed.contains(&leaf) {
                let chosen = traverse_upwards(child_lookup, epsilon, leaf, root);
                selected.insert(chosen);
                for sub in bfs(chosen) {
                    if sub != chosen {
                        processed.insert(sub);
                    }
                }
            }
        } else {
            selected.insert(leaf);
        }
    }
    selected
}

fn traverse_upwards(
    child_lookup: &HashMap<usize, (usize, f64)>,
    epsilon: f64,
    mut leaf: usize,
    root: usize,
) -> usize {
    loop {
        let parent = child_lookup[&leaf].0;
        if parent == root {
            return leaf;
        }
        let parent_eps = 1.0 / child_lookup[&parent].1;
        if parent_eps > epsilon {
            return parent;
        }
        leaf = parent;
    }
}

/// `do_labelling` with `TreeUnionFind` (union by rank, path compression).
fn do_labelling(tree: &[Condensed], label_of: &HashMap<usize, i64>) -> Vec<i64> {
    let root = tree.iter().map(|r| r.parent).min().unwrap_or(0);
    let size = tree.iter().map(|r| r.parent).max().unwrap_or(0) + 1;
    let mut parent: Vec<usize> = (0..size).collect();
    let mut rank = vec![0usize; size];
    fn find(parent: &mut [usize], x: usize) -> usize {
        let mut r = x;
        while parent[r] != r {
            r = parent[r];
        }
        let mut y = x;
        while parent[y] != r {
            let up = parent[y];
            parent[y] = r;
            y = up;
        }
        r
    }
    for r in tree {
        if label_of.contains_key(&r.child) {
            continue;
        }
        let xr = find(&mut parent, r.parent);
        let yr = find(&mut parent, r.child);
        if rank[xr] < rank[yr] {
            parent[xr] = yr;
        } else if rank[xr] > rank[yr] {
            parent[yr] = xr;
        } else {
            parent[yr] = xr;
            rank[xr] += 1;
        }
    }
    (0..root)
        .map(|n| {
            let c = find(&mut parent, n);
            if c <= root {
                -1
            } else {
                label_of.get(&c).copied().unwrap_or(-1)
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params(mcs: i64, ms: i64, eps: f64) -> Params {
        Params {
            min_cluster_size: mcs,
            min_samples: ms,
            cluster_selection_epsilon: eps,
        }
    }

    #[test]
    fn two_blobs_and_noise() {
        let mut data = Vec::new();
        for i in 0..5 {
            data.extend([0.0 + i as f64 * 0.01, 0.0]);
        }
        for i in 0..5 {
            data.extend([10.0 + i as f64 * 0.01, 10.0]);
        }
        data.extend([50.0, -50.0]);
        let l = labels(&data, 2, &params(2, 1, 0.0)).unwrap();
        assert_eq!(l, vec![0, 0, 0, 0, 0, 1, 1, 1, 1, 1, -1]);
    }

    #[test]
    fn errors_and_edges() {
        assert_eq!(
            labels(&[], 4, &params(2, 1, 0.0)).unwrap(),
            Vec::<i64>::new()
        );
        assert!(labels(&[0.0; 4], 4, &params(2, 1, 0.0)).is_err());
        assert!(labels(&[0.0; 8], 4, &params(1, 1, 0.0)).is_err());
        assert_eq!(
            labels(&[0.0; 8], 4, &params(2, 1, 0.05)).unwrap(),
            vec![-1, -1]
        );
        assert_eq!(
            labels(&[0.0; 12], 4, &params(2, 1, 0.05)).unwrap(),
            vec![-1; 3]
        );
    }

    #[test]
    fn non_finite_rows_are_noise() {
        let mut data = Vec::new();
        for i in 0..5 {
            data.extend([i as f64 * 0.01, 0.0]);
        }
        data.extend([f64::NAN, 0.0]);
        for i in 0..5 {
            data.extend([10.0 + i as f64 * 0.01, 10.0]);
        }
        data.extend([f64::INFINITY, 1.0]);
        let l = labels(&data, 2, &params(2, 1, 0.0)).unwrap();
        assert_eq!(l, vec![0, 0, 0, 0, 0, -1, 1, 1, 1, 1, 1, -1]);
        let err = labels(&[f64::NAN; 6], 2, &params(2, 1, 0.0)).unwrap_err();
        assert!(
            err.starts_with("Found array with 0 sample(s) (shape=(0, 2))"),
            "{err}"
        );
    }
}
