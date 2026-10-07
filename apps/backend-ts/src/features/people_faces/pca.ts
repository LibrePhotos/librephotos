// scikit-learn's PCA(n_components=k).fit_transform for the face scatter plot
// of /api/clusterfaces (port of lp_ml::face_cluster::pca).
//
// The data is centered and the top eigenvectors of the smaller of the
// covariance (XᵀX, d×d) and Gram (XXᵀ, n×n) matrices are found by orthogonal
// (block power) iteration with a Rayleigh-Ritz step. Signs follow sklearn's
// svd_flip(u_based_decision=False): the largest-magnitude entry of each
// component is positive, so scores match sklearn up to float error.
// Unlike sklearn, fewer samples (or features) than components is not an
// error: the missing components score 0.

type Vec = Float64Array;

function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

function symmetrize(a: Float64Array, m: number) {
  for (let i = 0; i < m; i++) for (let j = 0; j < i; j++) a[i * m + j] = a[j * m + i];
}

function matVec(a: Float64Array, m: number, v: Vec): Vec {
  const out = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    let s = 0;
    const o = i * m;
    for (let j = 0; j < m; j++) s += a[o + j] * v[j];
    out[i] = s;
  }
  return out;
}

const MASK = (1n << 64n) - 1n;
class Rng {
  constructor(public seed: bigint) {}
  next(): number {
    this.seed = (this.seed * 6364136223846793005n + 1442695040888963407n) & MASK;
    return Number(this.seed >> 11n) / 2 ** 53 - 0.5;
  }
}

/** Modified Gram-Schmidt; columns that vanish are replaced by fresh pseudo-random directions. */
function orthonormalize(q: Vec[], rng: Rng) {
  for (let i = 0; i < q.length; i++) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const v = q[i];
      for (let pass = 0; pass < 2; pass++) {
        for (let u = 0; u < i; u++) {
          const p = dot(q[u], v);
          const uu = q[u];
          for (let x = 0; x < v.length; x++) v[x] -= p * uu[x];
        }
      }
      const norm = Math.sqrt(dot(v, v));
      if (norm > 1e-12) {
        for (let x = 0; x < v.length; x++) v[x] /= norm;
        break;
      }
      if (attempt === 3) {
        v.fill(0);
        break;
      }
      for (let x = 0; x < v.length; x++) v[x] = rng.next();
    }
  }
}

/** Eigen-decomposition of a small symmetric matrix (cyclic Jacobi), eigenvalues descending. */
function jacobiEigen(t: Float64Array, b: number): [number[], Vec[]] {
  const a = Float64Array.from(t);
  const v = new Float64Array(b * b);
  for (let i = 0; i < b; i++) v[i * b + i] = 1;
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < b; i++) for (let j = 0; j < b; j++) if (i !== j) off += a[i * b + j] ** 2;
    if (off < 1e-30) break;
    for (let p = 0; p < b; p++) {
      for (let q = p + 1; q < b; q++) {
        const apq = a[p * b + q];
        if (Math.abs(apq) < 1e-300) continue;
        const theta = (a[q * b + q] - a[p * b + p]) / (2 * apq);
        let tt = Math.sign(theta) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        if (theta === 0) tt = 1;
        const c = 1 / Math.sqrt(tt * tt + 1);
        const s = tt * c;
        for (let k = 0; k < b; k++) {
          const akp = a[k * b + p];
          const akq = a[k * b + q];
          a[k * b + p] = c * akp - s * akq;
          a[k * b + q] = s * akp + c * akq;
        }
        for (let k = 0; k < b; k++) {
          const apk = a[p * b + k];
          const aqk = a[q * b + k];
          a[p * b + k] = c * apk - s * aqk;
          a[q * b + k] = s * apk + c * aqk;
        }
        for (let k = 0; k < b; k++) {
          const vkp = v[k * b + p];
          const vkq = v[k * b + q];
          v[k * b + p] = c * vkp - s * vkq;
          v[k * b + q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const order = [...Array(b).keys()].sort((x, y) => a[y * b + y] - a[x * b + x]);
  return [
    order.map((i) => a[i * b + i]),
    order.map((i) => {
      const col = new Float64Array(b);
      for (let r = 0; r < b; r++) col[r] = v[r * b + i];
      return col;
    }),
  ];
}

/** Top k eigenpairs of the symmetric positive semi-definite a (m×m), eigenvalues descending. */
function topEigen(a: Float64Array, m: number, k: number): [number[], Vec[]] {
  if (k === 0) return [[], []];
  const b = Math.min(m, k + 6);
  const rng = new Rng(0x5eedn);
  let q: Vec[] = [];
  for (let i = 0; i < b; i++) {
    const v = new Float64Array(m);
    for (let j = 0; j < m; j++) v[j] = rng.next();
    q.push(v);
  }
  orthonormalize(q, rng);
  let scale = 0;
  for (let i = 0; i < m; i++) scale += a[i * m + i];
  scale = Math.max(scale, 2.2250738585072014e-308); // f64::MIN_POSITIVE
  let ritz: [number[], Vec[]] = [[], []];
  for (let iter = 0; iter < 3000; iter++) {
    const z = q.map((v) => matVec(a, m, v));
    const t = new Float64Array(b * b);
    for (let i = 0; i < b; i++) for (let j = 0; j < b; j++) t[i * b + j] = dot(q[i], z[j]);
    symmetrize(t, b);
    const [vals, w] = jacobiEigen(t, b);
    const vecs = w.map((wi) => {
      const y = new Float64Array(m);
      for (let c = 0; c < b; c++) {
        const qc = q[c];
        const coef = wi[c];
        for (let x = 0; x < m; x++) y[x] += coef * qc[x];
      }
      return y;
    });
    let converged = true;
    for (let i = 0; i < k && converged; i++) {
      const ay = matVec(a, m, vecs[i]);
      let r = 0;
      for (let x = 0; x < m; x++) r += (ay[x] - vals[i] * vecs[i][x]) ** 2;
      if (Math.sqrt(r) > 1e-11 * scale) converged = false;
    }
    ritz = [vals, vecs];
    if (converged || b === m) break;
    q = z;
    orthonormalize(q, rng);
  }
  return [ritz[0].slice(0, k).map((v) => Math.max(v, 0)), ritz[1].slice(0, k)];
}

/** rows (n samples × d features) projected on the top k components. */
export function pcaScores(rows: number[][], k: number): number[][] {
  const n = rows.length;
  if (n === 0) return [];
  const d = rows[0].length;
  const mean = new Float64Array(d);
  for (const r of rows) for (let j = 0; j < d; j++) mean[j] += r[j];
  for (let j = 0; j < d; j++) mean[j] /= n;
  const xc = rows.map((r) => {
    const v = new Float64Array(d);
    for (let j = 0; j < d; j++) v[j] = r[j] - mean[j];
    return v;
  });
  const covariance = d <= n;
  const m = Math.min(d, n);
  let mat: Float64Array;
  if (covariance) {
    mat = new Float64Array(d * d);
    for (const r of xc) {
      for (let i = 0; i < d; i++) {
        const ri = r[i];
        if (ri === 0) continue;
        const o = i * d;
        for (let j = i; j < d; j++) mat[o + j] += ri * r[j];
      }
    }
  } else {
    mat = new Float64Array(n * n);
    for (let i = 0; i < n; i++) for (let j = i; j < n; j++) mat[i * n + j] = dot(xc[i], xc[j]);
  }
  symmetrize(mat, m);
  const kk = Math.min(k, m);
  const [vals, vecs] = topEigen(mat, m, kk);
  const components: Vec[] = [];
  for (let c = 0; c < vals.length; c++) {
    let comp: Vec;
    if (covariance) comp = Float64Array.from(vecs[c]);
    else {
      // v = Xcᵀ u / |Xcᵀ u|
      comp = new Float64Array(d);
      const u = vecs[c];
      for (let i = 0; i < n; i++) {
        const r = xc[i];
        for (let j = 0; j < d; j++) comp[j] += u[i] * r[j];
      }
      const norm = Math.sqrt(dot(comp, comp));
      if (norm > 0 && vals[c] > 0) for (let j = 0; j < d; j++) comp[j] /= norm;
      else comp.fill(0);
    }
    let best = 0;
    for (let j = 0; j < comp.length; j++) if (Math.abs(comp[j]) > Math.abs(comp[best])) best = j;
    if (comp.length && comp[best] < 0) for (let j = 0; j < comp.length; j++) comp[j] = -comp[j];
    components.push(comp);
  }
  return xc.map((r) => Array.from({ length: k }, (_, i) => (i < components.length ? dot(r, components[i]) : 0)));
}
