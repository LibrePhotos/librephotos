// `hdbscan.HDBSCAN(metric="euclidean").fit(X).labels_` as hdbscan 0.8.44 runs
// it for face encodings (prims_kdtree): core distances, Prim's MST on the
// mutual reachability graph, single linkage, condensed tree, excess-of-mass
// selection with the cluster_selection_epsilon search, labelling. Defaults as
// face_classify leaves them (alpha 1, eom, allow_single_cluster False). Port
// of lp_ml::face_cluster::hdbscan.
//
// Distances are summed feature by feature like the Cython `euclidean_dist`,
// so they are bit-identical and the MST is the same tree. Rust prunes its
// O(n²) scans with f32 / i8 copies; here a partial sum of squares (which
// only grows) is compared with the bound instead, so a row is skipped only
// when its exact distance cannot matter.

export interface Params {
  min_cluster_size: number;
  min_samples: number;
  cluster_selection_epsilon: number;
}

/** Features summed between bound checks. */
const CHECK_EVERY = 32;

/**
 * Squared distance of rows `i` and `j`, summed in feature order; any value
 * above `bound` once the partial sum exceeds it (the sum never decreases).
 */
function rdistBounded(data: Float64Array, d: number, i: number, j: number, bound: number): number {
  const a = i * d;
  const b = j * d;
  let s = 0;
  let f = 0;
  while (f < d) {
    const end = Math.min(f + CHECK_EVERY, d);
    for (; f < end; f++) {
      const t = data[a + f] - data[b + f];
      s += t * t;
    }
    if (s > bound) return s;
  }
  return s;
}

/** Cluster labels (-1 noise) of the `n` rows of `data` (row-major, `d` features). Errors carry the Python text. */
export function labels(data: Float64Array, d: number, p: Params): number[] {
  const n = d > 0 ? Math.floor(data.length / d) : 0;
  if (p.min_samples <= 0 || p.min_cluster_size <= 0) throw new Error("Min samples and Min cluster size must be positive integers");
  if (p.min_cluster_size === 1) throw new Error("Min cluster size must be greater than one");
  if (Number.isNaN(p.cluster_selection_epsilon) || p.cluster_selection_epsilon < 0) throw new Error("Epsilon must be a float value greater than or equal to 0!");
  if (n === 0) return [];
  // HDBSCAN.fit clusters the finite rows only; the others are noise.
  const finite: number[] = [];
  for (let i = 0; i < n; i++) {
    let ok = true;
    for (let f = i * d; f < (i + 1) * d; f++)
      if (!Number.isFinite(data[f])) {
        ok = false;
        break;
      }
    if (ok) finite.push(i);
  }
  if (finite.length < n) {
    if (!finite.length) throw new Error(`Found array with 0 sample(s) (shape=(0, ${d})) while a minimum of 1 is required.`);
    const clean = new Float64Array(finite.length * d);
    finite.forEach((i, k) => clean.set(data.subarray(i * d, (i + 1) * d), k * d));
    const inner = labels(clean, d, p);
    const out = new Array<number>(n).fill(-1);
    finite.forEach((i, k) => (out[i] = inner[k]));
    return out;
  }
  const minSamples = Math.max(Math.min(p.min_samples, n - 1), 1);
  if (minSamples + 1 > n) throw new Error("k must be less than or equal to the number of training points");
  const core = coreDistances(data, d, n, minSamples + 1);
  const mst = primMst(data, d, core);
  // `np.argsort(mst.T[2])`; equal weights keep Prim's order (stable sort).
  const order = Array.from({ length: mst.w.length }, (_, i) => i).sort((a, b) => mst.w[a] - mst.w[b]);
  const sorted = {
    a: Int32Array.from(order, (i) => mst.a[i]),
    b: Int32Array.from(order, (i) => mst.b[i]),
    w: Float64Array.from(order, (i) => mst.w[i]),
  };
  const hierarchy = singleLinkage(sorted, n);
  const tree = condenseTree(hierarchy, n, p.min_cluster_size);
  return getClusters(tree, p.cluster_selection_epsilon);
}

/** `KDTree.query(X, k)[0][:, -1]`: distance to the k-th nearest row, the row itself included. */
function coreDistances(data: Float64Array, d: number, n: number, k: number): Float64Array {
  const out = new Float64Array(n);
  const best = new Float64Array(k);
  for (let i = 0; i < n; i++) {
    let len = 0;
    for (let j = 0; j < n; j++) {
      const bound = len === k ? best[k - 1] : Infinity;
      const v = rdistBounded(data, d, i, j, bound);
      if (len === k && v >= best[k - 1]) continue;
      // Insert after equal values (partition_point(x <= v)).
      let pos = len;
      while (pos > 0 && best[pos - 1] > v) pos--;
      for (let q = Math.min(len, k - 1); q > pos; q--) best[q] = best[q - 1];
      best[pos] = v;
      if (len < k) len++;
    }
    out[i] = Math.sqrt(best[k - 1]);
  }
  return out;
}

interface Edges {
  a: Int32Array;
  b: Int32Array;
  w: Float64Array;
}

/**
 * `mst_linkage_core_vector` (alpha 1): Prim's algorithm on the mutual
 * reachability distance, edges in the order the nodes join the tree. The next
 * node is the lowest index one at the smallest distance, as in the Cython loop.
 */
function primMst(data: Float64Array, d: number, core: Float64Array): Edges {
  const n = core.length;
  const m = Math.max(n - 1, 0);
  const ea = new Int32Array(m);
  const eb = new Int32Array(m);
  const ew = new Float64Array(m);
  if (n < 2) return { a: ea, b: eb, w: ew };
  const dist = new Float64Array(n).fill(Infinity);
  const source = new Int32Array(n).fill(1);
  // The nodes not yet in the tree (node 0 joins first); order is irrelevant
  // since ties go to the lowest index.
  const live = Int32Array.from({ length: n - 1 }, (_, i) => i + 1);
  let liveCount = n - 1;
  let current = 0;
  let edges = 0;
  while (liveCount > 0) {
    const coreCur = core[current];
    let bestValue = Number.MAX_VALUE;
    let bestNode = -1;
    let bestPos = -1;
    for (let pos = 0; pos < liveCount; pos++) {
      const j = live[pos];
      const right = dist[j];
      const coreJ = core[j];
      let value = right;
      if (!(coreCur > right || coreJ > right)) {
        // Past right² (with margin) sqrt(s) > right: the row keeps its distance.
        const bound = right === Infinity ? Infinity : right * right * (1 + 1e-12);
        const left = Math.sqrt(rdistBounded(data, d, current, j, bound));
        if (left <= right) {
          const mr = coreJ > coreCur ? (coreJ > left ? coreJ : left) : coreCur > left ? coreCur : left;
          if (mr < right) {
            dist[j] = mr;
            source[j] = current;
            value = mr;
          }
        }
      }
      // Strictly below DBL_MAX, like `if value < new_distance`.
      if (value < Number.MAX_VALUE && (bestPos < 0 || value < bestValue || (value === bestValue && j < bestNode))) {
        bestValue = value;
        bestNode = j;
        bestPos = pos;
      }
    }
    // Only non-finite data gets here: the Cython loop keeps node 0.
    if (bestPos < 0) {
      ea[edges] = 0;
      eb[edges] = 0;
      ew[edges] = Number.MAX_VALUE;
      edges++;
      break;
    }
    ea[edges] = source[bestNode];
    eb[edges] = bestNode;
    ew[edges] = bestValue;
    edges++;
    live[bestPos] = live[--liveCount];
    current = bestNode;
  }
  return { a: ea.subarray(0, edges), b: eb.subarray(0, edges), w: ew.subarray(0, edges) };
}

/** A single-linkage hierarchy (scipy format): children, distance, size. */
interface Hierarchy {
  left: Int32Array;
  right: Int32Array;
  delta: Float64Array;
  size: Int32Array;
}

/** `_hdbscan_linkage.label`: sorted MST edges to a scipy-style hierarchy. */
function singleLinkage(mst: Edges, n: number): Hierarchy {
  const total = 2 * n - 1;
  const parent = new Int32Array(total).fill(-1);
  const size = new Int32Array(total);
  for (let i = 0; i < n; i++) size[i] = 1;
  const find = (x0: number) => {
    let x = x0;
    while (parent[x] !== -1) x = parent[x];
    let p = x0;
    while (parent[p] !== x && parent[p] !== -1) {
      const up = parent[p];
      parent[p] = x;
      p = up;
    }
    return x;
  };
  const m = mst.w.length;
  const h: Hierarchy = { left: new Int32Array(m), right: new Int32Array(m), delta: new Float64Array(m), size: new Int32Array(m) };
  let next = n;
  for (let e = 0; e < m; e++) {
    const aa = find(mst.a[e]);
    const bb = find(mst.b[e]);
    const s = size[aa] + size[bb];
    h.left[e] = aa;
    h.right[e] = bb;
    h.delta[e] = mst.w[e];
    h.size[e] = s;
    size[next] = s;
    parent[aa] = next;
    parent[bb] = next;
    next++;
  }
  return h;
}

/** Condensed-tree rows. */
interface Condensed {
  parent: number[];
  child: number[];
  lambda: number[];
  childSize: number[];
}

/** `bfs_from_hierarchy`: `root` and its descendants, level by level. */
function bfsHierarchy(h: Hierarchy, root: number, n: number): number[] {
  const result: number[] = [];
  let level = [root];
  while (level.length) {
    result.push(...level);
    const next: number[] = [];
    for (const x of level) {
      if (x >= n) {
        next.push(h.left[x - n], h.right[x - n]);
      }
    }
    level = next;
  }
  return result;
}

/** `condense_tree`. */
function condenseTree(h: Hierarchy, n: number, minClusterSize: number): Condensed {
  const root = 2 * h.delta.length;
  let nextLabel = n + 1;
  const nodeList = bfsHierarchy(h, root, n);
  const relabel = new Int32Array(root + 1);
  relabel[root] = n;
  const ignore = new Uint8Array(root + 1);
  const out: Condensed = { parent: [], child: [], lambda: [], childSize: [] };
  const push = (parent: number, child: number, lambda: number, childSize: number) => {
    out.parent.push(parent);
    out.child.push(child);
    out.lambda.push(lambda);
    out.childSize.push(childSize);
  };
  const count = (node: number) => (node >= n ? h.size[node - n] : 1);

  for (const node of nodeList) {
    if (ignore[node] || node < n) continue;
    const left = h.left[node - n];
    const right = h.right[node - n];
    const delta = h.delta[node - n];
    const lambda = delta > 0 ? 1 / delta : Infinity;
    const lc = count(left);
    const rc = count(right);
    const parent = relabel[node];
    const dropPoints = (sub: number) => {
      for (const s of bfsHierarchy(h, sub, n)) {
        if (s < n) push(parent, s, lambda, 1);
        ignore[s] = 1;
      }
    };
    if (lc >= minClusterSize && rc >= minClusterSize) {
      relabel[left] = nextLabel++;
      push(parent, relabel[left], lambda, lc);
      relabel[right] = nextLabel++;
      push(parent, relabel[right], lambda, rc);
    } else if (lc < minClusterSize && rc < minClusterSize) {
      dropPoints(left);
      dropPoints(right);
    } else if (lc < minClusterSize) {
      relabel[right] = parent;
      dropPoints(left);
    } else {
      relabel[left] = parent;
      dropPoints(right);
    }
  }
  return out;
}

const minOf = (a: number[]) => a.reduce((m, v) => (v < m ? v : m), Infinity);
const maxOf = (a: number[]) => a.reduce((m, v) => (v > m ? v : m), -Infinity);

/** `compute_stability`: stability per cluster id from the root (`smallest`) up. */
function computeStability(t: Condensed): [number, Float64Array] {
  const rows = t.parent.length;
  const smallest = rows ? minOf(t.parent) : 0;
  const largestParent = rows ? maxOf(t.parent) : 0;
  const largestChild = Math.max(rows ? maxOf(t.child) : 0, smallest);
  const births = new Float64Array(largestChild + 1).fill(NaN);
  for (let r = 0; r < rows; r++) {
    const c = t.child[r];
    if (Number.isNaN(births[c]) || t.lambda[r] < births[c]) births[c] = t.lambda[r];
  }
  births[smallest] = 0;
  const result = new Float64Array(largestParent - smallest + 1);
  for (let r = 0; r < rows; r++) result[t.parent[r] - smallest] += (t.lambda[r] - births[t.parent[r]]) * t.childSize[r];
  return [smallest, result];
}

/** `get_clusters(..., "eom", allow_single_cluster=False, epsilon)` and `do_labelling`: the labels. */
function getClusters(t: Condensed, epsilon: number): number[] {
  const [smallest, stability] = computeStability(t);
  const largest = smallest + stability.length - 1;
  // `sorted(stability.keys(), reverse=True)[:-1]`: every cluster but the root.
  const nodeList: number[] = [];
  for (let c = largest; c > smallest; c--) nodeList.push(c);
  const children = new Map<number, number[]>();
  const childLookup = new Map<number, [number, number]>();
  let ctRoot = Infinity;
  let anyClusterRow = false;
  for (let r = 0; r < t.parent.length; r++) {
    if (t.childSize[r] <= 1) continue;
    anyClusterRow = true;
    const p = t.parent[r];
    let list = children.get(p);
    if (!list) children.set(p, (list = []));
    list.push(t.child[r]);
    childLookup.set(t.child[r], [p, t.lambda[r]]);
    ctRoot = Math.min(ctRoot, p);
  }
  if (!anyClusterRow) ctRoot = 0;
  const bfs = (root: number) => {
    const out: number[] = [];
    let level = [root];
    while (level.length) {
      out.push(...level);
      const next: number[] = [];
      for (const x of level) next.push(...(children.get(x) ?? []));
      level = next;
    }
    return out;
  };
  const stab = (id: number) => (id - smallest < stability.length ? stability[id - smallest] : NaN);

  const isCluster = new Map<number, boolean>(nodeList.map((c) => [c, true]));
  for (const node of nodeList) {
    // `cdef float subtree_stability`: each sum is rounded to f32.
    let subtree = 0;
    for (const ch of children.get(node) ?? []) subtree = Math.fround(subtree + stab(ch));
    if (subtree > stab(node)) {
      isCluster.set(node, false);
      stability[node - smallest] = subtree;
    } else {
      for (const sub of bfs(node)) if (sub !== node) isCluster.set(sub, false);
    }
  }

  if (epsilon !== 0 && anyClusterRow) {
    const eom = nodeList.filter((c) => isCluster.get(c));
    const selected = eom.length === 1 && eom[0] === ctRoot ? new Set<number>() : epsilonSearch(eom, childLookup, bfs, epsilon, ctRoot);
    for (const c of nodeList) isCluster.set(c, selected.has(c));
  }

  const clusters = nodeList.filter((c) => isCluster.get(c)).sort((a, b) => a - b);
  const labelOf = new Map<number, number>(clusters.map((c, i) => [c, i]));
  return doLabelling(t, labelOf);
}

/** `_epsilon_search_fast` (allow_single_cluster False). */
function epsilonSearch(leaves: number[], childLookup: Map<number, [number, number]>, bfs: (root: number) => number[], epsilon: number, root: number): Set<number> {
  const selected = new Set<number>();
  const processed = new Set<number>();
  for (const leaf of leaves) {
    const eps = 1 / childLookup.get(leaf)![1];
    if (eps < epsilon) {
      if (!processed.has(leaf)) {
        const chosen = traverseUpwards(childLookup, epsilon, leaf, root);
        selected.add(chosen);
        for (const sub of bfs(chosen)) if (sub !== chosen) processed.add(sub);
      }
    } else selected.add(leaf);
  }
  return selected;
}

function traverseUpwards(childLookup: Map<number, [number, number]>, epsilon: number, leaf0: number, root: number): number {
  let leaf = leaf0;
  for (;;) {
    const parent = childLookup.get(leaf)![0];
    if (parent === root) return leaf;
    const parentEps = 1 / childLookup.get(parent)![1];
    if (parentEps > epsilon) return parent;
    leaf = parent;
  }
}

/** `do_labelling` with TreeUnionFind (union by rank, path compression). */
function doLabelling(t: Condensed, labelOf: Map<number, number>): number[] {
  const rows = t.parent.length;
  const root = rows ? minOf(t.parent) : 0;
  const size = (rows ? maxOf(t.parent) : 0) + 1;
  const parent = Int32Array.from({ length: size }, (_, i) => i);
  const rank = new Int32Array(size);
  const find = (x: number) => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    let y = x;
    while (parent[y] !== r) {
      const up = parent[y];
      parent[y] = r;
      y = up;
    }
    return r;
  };
  for (let r = 0; r < rows; r++) {
    if (labelOf.has(t.child[r])) continue;
    const xr = find(t.parent[r]);
    const yr = find(t.child[r]);
    if (rank[xr] < rank[yr]) parent[xr] = yr;
    else if (rank[xr] > rank[yr]) parent[yr] = xr;
    else {
      parent[yr] = xr;
      rank[xr]++;
    }
  }
  return Array.from({ length: root }, (_, i) => {
    const c = find(i);
    return c <= root ? -1 : (labelOf.get(c) ?? -1);
  });
}
