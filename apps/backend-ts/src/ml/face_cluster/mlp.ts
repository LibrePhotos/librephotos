// `MLPClassifier(solver="adam", alpha=1e-5, random_state=1, max_iter=1000)`
// (scikit-learn 1.9) as face_classify fits it: one hidden layer of 100 relu
// units, softmax output (logistic for one or two classes), minibatches of
// min(200, n), shuffled every epoch, stopping once the training loss has not
// improved by tol=1e-4 for more than 10 epochs. Port of
// lp_ml::face_cluster::mlp.
//
// The initial weights and the epoch shuffles come from numpy's legacy
// RandomState(1) (MT19937), reproduced bit for bit, so training follows the
// same path as sklearn; only the matrix products round differently from BLAS.

const HIDDEN = 100;
const ALPHA = 1e-5;
const LEARNING_RATE = 0.001;
const BETA_1 = 0.9;
const BETA_2 = 0.999;
const EPSILON = 1e-8;
const MAX_ITER = 1000;
const TOL = 1e-4;
const N_ITER_NO_CHANGE = 10;
const SEED = 1;

/** numpy's RandomState bit generator (MT19937, legacy seeding). */
export class Mt19937 {
  private key = new Uint32Array(624);
  private pos = 624;

  constructor(seed: number) {
    let s = seed >>> 0;
    for (let i = 0; i < 624; i++) {
      this.key[i] = s;
      s = (Math.imul(1812433253, s ^ (s >>> 30)) + i + 1) >>> 0;
    }
  }

  private generate() {
    const k = this.key;
    for (let i = 0; i < 624; i++) {
      const y = ((k[i] & 0x80000000) | (k[(i + 1) % 624] & 0x7fffffff)) >>> 0;
      k[i] = (k[(i + 397) % 624] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0)) >>> 0;
    }
    this.pos = 0;
  }

  nextU32(): number {
    if (this.pos === 624) this.generate();
    let y = this.key[this.pos++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    return (y ^ (y >>> 18)) >>> 0;
  }

  /** `random_sample()`: 53 random bits. */
  nextF64(): number {
    const a = this.nextU32() >>> 5;
    const b = this.nextU32() >>> 6;
    return (a * 67108864 + b) / 9007199254740992;
  }

  /** `uniform(low, high)`. */
  uniform(low: number, high: number): number {
    return low + (high - low) * this.nextF64();
  }

  /** `random_interval(max)`: uniform in 0..=max by masked rejection (max < 2^32). */
  private interval(max: number): number {
    if (max === 0) return 0;
    let mask = max;
    for (const s of [1, 2, 4, 8, 16]) mask = (mask | (mask >>> s)) >>> 0;
    for (;;) {
      const v = (this.nextU32() & mask) >>> 0;
      if (v <= max) return v;
    }
  }

  /** `RandomState.shuffle` of a 1-d array (Fisher-Yates from the end). */
  shuffle<T>(x: T[] | Int32Array): void {
    for (let i = x.length - 1; i >= 1; i--) {
      const j = this.interval(i);
      const t = x[i];
      x[i] = x[j];
      x[j] = t;
    }
  }
}

type Output = "softmax" | "logistic";

/** `c (m x n) = a (m x k) · b (k x n)`, all row-major. */
function matmul(a: Float64Array, b: Float64Array, m: number, k: number, n: number, c = new Float64Array(m * n)): Float64Array {
  c.fill(0, 0, m * n);
  for (let i = 0; i < m; i++) {
    const ci = i * n;
    for (let p = 0; p < k; p++) {
      const av = a[i * k + p];
      if (av === 0) continue;
      const bp = p * n;
      for (let j = 0; j < n; j++) c[ci + j] += av * b[bp + j];
    }
  }
  return c;
}

/** `c (k x n) = aᵀ · b` for a (m x k), b (m x n). */
function matmulTa(a: Float64Array, b: Float64Array, m: number, k: number, n: number, c = new Float64Array(k * n)): Float64Array {
  c.fill(0, 0, k * n);
  for (let i = 0; i < m; i++) {
    const bi = i * n;
    for (let p = 0; p < k; p++) {
      const av = a[i * k + p];
      if (av === 0) continue;
      const cp = p * n;
      for (let j = 0; j < n; j++) c[cp + j] += av * b[bi + j];
    }
  }
  return c;
}

/** `c (m x k) = a · bᵀ` for a (m x n), b (k x n). */
function matmulTb(a: Float64Array, b: Float64Array, m: number, n: number, k: number, c = new Float64Array(m * k)): Float64Array {
  for (let i = 0; i < m; i++) {
    for (let p = 0; p < k; p++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += a[i * n + j] * b[p * n + j];
      c[i * k + p] = s;
    }
  }
  return c;
}

function activate(out: Output, a: Float64Array, rows: number, cols: number) {
  if (out === "logistic") {
    for (let i = 0; i < rows * cols; i++) a[i] = 1 / (1 + Math.exp(-a[i]));
    return;
  }
  for (let r = 0; r < rows; r++) {
    const o = r * cols;
    let max = -Infinity;
    for (let c = 0; c < cols; c++) max = Math.max(max, a[o + c]);
    let sum = 0;
    for (let c = 0; c < cols; c++) {
      a[o + c] = Math.exp(a[o + c] - max);
      sum += a[o + c];
    }
    for (let c = 0; c < cols; c++) a[o + c] /= sum;
  }
}

/** `log_loss` / `binary_log_loss` of a batch (for the stopping rule). */
function loss(out: Output, y: Float64Array, p: Float64Array, rows: number, cols: number): number {
  const eps = Number.EPSILON;
  const clip = (v: number) => (v < eps ? eps : v > 1 - eps ? 1 - eps : v);
  const xlogy = (a: number, b: number) => (a === 0 ? 0 : a * Math.log(b));
  let total = 0;
  if (out === "softmax") {
    for (let c = 0; c < cols; c++) {
      let col = 0;
      for (let r = 0; r < rows; r++) col += xlogy(y[r * cols + c], clip(p[r * cols + c]));
      total += col / rows;
    }
  } else {
    let col = 0;
    for (let r = 0; r < rows; r++) {
      const q = clip(p[r]);
      col += xlogy(y[r], q) + xlogy(1 - y[r], 1 - q);
    }
    total = col / rows;
  }
  return -total;
}

/** A row-major matrix of `rows` x `cols`. */
export interface Matrix {
  data: Float64Array;
  rows: number;
  cols: number;
}

export function toMatrix(rows: ArrayLike<number>[]): Matrix {
  const d = rows.length ? rows[0].length : 0;
  const data = new Float64Array(rows.length * d);
  rows.forEach((r, i) => data.set(r, i * d));
  return { data, rows: rows.length, cols: d };
}

/** A fitted classifier: `classes` ascending, as `classes_`. */
export class Mlp {
  private constructor(
    readonly classes: number[],
    private out: Output,
    private w0: Float64Array,
    private w1: Float64Array,
    private b0: Float64Array,
    private b1: Float64Array,
    private d: number,
    private nOut: number,
    readonly nIter: number,
  ) {}

  /** `MLPClassifier(...).fit(x, y)`. Errors carry sklearn's text. */
  static fit(xIn: Matrix | number[][], y: ArrayLike<number>): Mlp {
    const x = Array.isArray(xIn) ? toMatrix(xIn) : xIn;
    const { rows: n, cols: d } = x;
    if (n === 0) throw new Error(`Found array with 0 sample(s) (shape=(0, ${d})) while a minimum of 1 is required by MLPClassifier.`);
    if (d === 0) throw new Error(`Found array with 0 feature(s) (shape=(${n}, 0)) while a minimum of 1 is required by MLPClassifier.`);
    const classes = [...new Set(Array.from(y))].sort((a, b) => a - b);
    let out: Output;
    let nOut: number;
    let targets: Float64Array;
    if (classes.length > 2) {
      out = "softmax";
      nOut = classes.length;
      const index = new Map(classes.map((c, i) => [c, i]));
      targets = new Float64Array(n * nOut);
      for (let r = 0; r < n; r++) targets[r * nOut + index.get(y[r])!] = 1;
    } else {
      // LabelBinarizer: one column, 1 for the second class (all zeros for one class).
      out = "logistic";
      nOut = 1;
      const pos = classes.length > 1 ? classes[1] : undefined;
      targets = Float64Array.from({ length: n }, (_, r) => (y[r] === pos ? 1 : 0));
    }

    const rng = new Mt19937(SEED);
    const init = (fanIn: number, fanOut: number): [Float64Array, Float64Array] => {
      const bound = Math.sqrt(6 / (fanIn + fanOut));
      const w = Float64Array.from({ length: fanIn * fanOut }, () => rng.uniform(-bound, bound));
      const b = Float64Array.from({ length: fanOut }, () => rng.uniform(-bound, bound));
      return [w, b];
    };
    const [w0, b0] = init(d, HIDDEN);
    const [w1, b1] = init(HIDDEN, nOut);
    const params = [w0, w1, b0, b1];
    const m = params.map((p) => new Float64Array(p.length));
    const v = params.map((p) => new Float64Array(p.length));
    let t = 0;

    const batch = Math.min(n, 200);
    let idx = Int32Array.from({ length: n }, (_, i) => i);
    let bestLoss = Infinity;
    let noImprovement = 0;
    let nIter = 0;
    const xb = new Float64Array(batch * d);
    const yb = new Float64Array(batch * nOut);
    const a1 = new Float64Array(batch * HIDDEN);
    const a2 = new Float64Array(batch * nOut);
    const delta1 = new Float64Array(batch * HIDDEN);
    const g0 = new Float64Array(d * HIDDEN);
    const g1 = new Float64Array(HIDDEN * nOut);
    const gb0 = new Float64Array(HIDDEN);
    const gb1 = new Float64Array(nOut);
    const grads = [g0, g1, gb0, gb1];
    const perm = new Int32Array(n);
    const next = new Int32Array(n);

    for (let iter = 0; iter < MAX_ITER; iter++) {
      // `sklearn.utils.shuffle(sample_idx)`: sample_idx[permutation].
      for (let i = 0; i < n; i++) perm[i] = i;
      rng.shuffle(perm);
      for (let i = 0; i < n; i++) next[i] = idx[perm[i]];
      idx = Int32Array.from(next);

      let accumulated = 0;
      for (let start = 0; start < n; start += batch) {
        const nb = Math.min(batch, n - start);
        for (let r = 0; r < nb; r++) {
          const i = idx[start + r];
          xb.set(x.data.subarray(i * d, (i + 1) * d), r * d);
          yb.set(targets.subarray(i * nOut, (i + 1) * nOut), r * nOut);
        }
        const xv = xb.subarray(0, nb * d);
        const yv = yb.subarray(0, nb * nOut);
        const h = a1.subarray(0, nb * HIDDEN);
        const o = a2.subarray(0, nb * nOut);
        const dl1 = delta1.subarray(0, nb * HIDDEN);

        matmul(xv, w0, nb, d, HIDDEN, h);
        for (let r = 0; r < nb; r++)
          for (let c = 0; c < HIDDEN; c++) {
            const val = h[r * HIDDEN + c] + b0[c];
            h[r * HIDDEN + c] = val > 0 ? val : 0;
          }
        matmul(h, w1, nb, HIDDEN, nOut, o);
        for (let r = 0; r < nb; r++) for (let c = 0; c < nOut; c++) o[r * nOut + c] += b1[c];
        activate(out, o, nb, nOut);

        let batchLoss = loss(out, yv, o, nb, nOut);
        let values = 0;
        for (const w of [w0, w1]) for (let i = 0; i < w.length; i++) values += w[i] * w[i];
        batchLoss += (0.5 * ALPHA * values) / nb;

        // delta2 = a2 - y (in place in o).
        for (let i = 0; i < nb * nOut; i++) o[i] -= yv[i];
        matmulTa(h, o, nb, HIDDEN, nOut, g1);
        for (let i = 0; i < g1.length; i++) g1[i] = (g1[i] + ALPHA * w1[i]) / nb;
        gb1.fill(0);
        for (let r = 0; r < nb; r++) for (let c = 0; c < nOut; c++) gb1[c] += o[r * nOut + c];
        for (let c = 0; c < nOut; c++) gb1[c] /= nb;
        matmulTb(o, w1, nb, nOut, HIDDEN, dl1);
        for (let i = 0; i < nb * HIDDEN; i++) if (h[i] === 0) dl1[i] = 0;
        matmulTa(xv, dl1, nb, d, HIDDEN, g0);
        for (let i = 0; i < g0.length; i++) g0[i] = (g0[i] + ALPHA * w0[i]) / nb;
        gb0.fill(0);
        for (let r = 0; r < nb; r++) for (let c = 0; c < HIDDEN; c++) gb0[c] += dl1[r * HIDDEN + c];
        for (let c = 0; c < HIDDEN; c++) gb0[c] /= nb;

        accumulated += batchLoss * nb;
        // Adam.
        t++;
        const lr = (LEARNING_RATE * Math.sqrt(1 - BETA_2 ** t)) / (1 - BETA_1 ** t);
        for (let k = 0; k < 4; k++) {
          const p = params[k];
          const g = grads[k];
          const mk = m[k];
          const vk = v[k];
          for (let i = 0; i < p.length; i++) {
            mk[i] = BETA_1 * mk[i] + (1 - BETA_1) * g[i];
            vk[i] = BETA_2 * vk[i] + (1 - BETA_2) * (g[i] * g[i]);
            p[i] += (-lr * mk[i]) / (Math.sqrt(vk[i]) + EPSILON);
          }
        }
      }
      nIter++;
      const epochLoss = accumulated / n;
      if (epochLoss > bestLoss - TOL) noImprovement++;
      else noImprovement = 0;
      if (epochLoss < bestLoss) bestLoss = epochLoss;
      if (noImprovement > N_ITER_NO_CHANGE) break;
    }
    if (!params.every((p) => p.every(Number.isFinite))) {
      throw new Error("Solver produced non-finite parameter weights. The input data may contain large values and need to be preprocessed.");
    }
    return new Mlp(classes, out, w0, w1, b0, b1, d, nOut, nIter);
  }

  /** `predict_proba`: one column per class, two for a logistic output ([1 - p, p], even with a single class). */
  predictProbaMatrix(x: Matrix): Matrix {
    const n = x.rows;
    const h = matmul(x.data, this.w0, n, this.d, HIDDEN);
    for (let r = 0; r < n; r++)
      for (let c = 0; c < HIDDEN; c++) {
        const val = h[r * HIDDEN + c] + this.b0[c];
        h[r * HIDDEN + c] = val > 0 ? val : 0;
      }
    const o = matmul(h, this.w1, n, HIDDEN, this.nOut);
    for (let r = 0; r < n; r++) for (let c = 0; c < this.nOut; c++) o[r * this.nOut + c] += this.b1[c];
    activate(this.out, o, n, this.nOut);
    if (this.out === "softmax") return { data: o, rows: n, cols: this.nOut };
    const two = new Float64Array(n * 2);
    for (let r = 0; r < n; r++) {
      two[r * 2] = 1 - o[r];
      two[r * 2 + 1] = o[r];
    }
    return { data: two, rows: n, cols: 2 };
  }

  predictProba(x: number[][]): number[][] {
    const p = this.predictProbaMatrix(toMatrix(x));
    return Array.from({ length: p.rows }, (_, r) => Array.from(p.data.subarray(r * p.cols, (r + 1) * p.cols)));
  }
}
