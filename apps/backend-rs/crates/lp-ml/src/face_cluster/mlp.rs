//! `MLPClassifier(solver="adam", alpha=1e-5, random_state=1, max_iter=1000)`
//! (scikit-learn 1.9) as face_classify fits it: one hidden layer of 100 relu
//! units, softmax output (logistic for one or two classes), minibatches of
//! `min(200, n)`, shuffled every epoch, stopping once the training loss has
//! not improved by `tol=1e-4` for more than 10 epochs.
//!
//! The initial weights and the epoch shuffles come from numpy's legacy
//! `RandomState(1)` (MT19937), reproduced bit for bit, so training follows
//! the same path as sklearn; only the matrix products round differently
//! from BLAS, which leaves the probabilities within float noise.

use ndarray::linalg::general_mat_mul;
use ndarray::{Array1, Array2, ArrayView2, ArrayViewMut2, Axis, s};
use rayon::prelude::*;

const HIDDEN: usize = 100;
const ALPHA: f64 = 1e-5;
const LEARNING_RATE: f64 = 0.001;
const BETA_1: f64 = 0.9;
const BETA_2: f64 = 0.999;
const EPSILON: f64 = 1e-8;
const MAX_ITER: usize = 1000;
const TOL: f64 = 1e-4;
const N_ITER_NO_CHANGE: usize = 10;
const SEED: u32 = 1;
/// Multiply-adds from which a product is split across the rayon pool (the
/// output layer of a fit with thousands of persons). Every output element
/// is computed exactly as unsplit, so the split never changes a result.
const PAR_WORK: usize = 1 << 24;
/// Elements from which the elementwise passes (Adam, softmax) go parallel.
const PAR_ELEMS: usize = 1 << 18;

/// numpy's `RandomState` bit generator (MT19937, legacy seeding).
pub struct Mt19937 {
    key: [u32; 624],
    pos: usize,
}

impl Mt19937 {
    pub fn new(seed: u32) -> Mt19937 {
        let mut key = [0u32; 624];
        let mut s = seed;
        for (i, k) in key.iter_mut().enumerate() {
            *k = s;
            s = 1812433253u32
                .wrapping_mul(s ^ (s >> 30))
                .wrapping_add(i as u32 + 1);
        }
        Mt19937 { key, pos: 624 }
    }

    fn generate(&mut self) {
        const UPPER: u32 = 0x8000_0000;
        const LOWER: u32 = 0x7fff_ffff;
        const MATRIX_A: u32 = 0x9908_b0df;
        let mag = |y: u32| if y & 1 == 1 { MATRIX_A } else { 0 };
        for i in 0..624 {
            let y = (self.key[i] & UPPER) | (self.key[(i + 1) % 624] & LOWER);
            self.key[i] = self.key[(i + 397) % 624] ^ (y >> 1) ^ mag(y);
        }
        self.pos = 0;
    }

    pub fn next_u32(&mut self) -> u32 {
        if self.pos == 624 {
            self.generate();
        }
        let mut y = self.key[self.pos];
        self.pos += 1;
        y ^= y >> 11;
        y ^= (y << 7) & 0x9d2c_5680;
        y ^= (y << 15) & 0xefc6_0000;
        y ^ (y >> 18)
    }

    fn next_u64(&mut self) -> u64 {
        let hi = self.next_u32() as u64;
        (hi << 32) | self.next_u32() as u64
    }

    /// `random_sample()`: 53 random bits.
    pub fn next_f64(&mut self) -> f64 {
        let a = (self.next_u32() >> 5) as f64;
        let b = (self.next_u32() >> 6) as f64;
        (a * 67108864.0 + b) / 9007199254740992.0
    }

    /// `uniform(low, high)`.
    pub fn uniform(&mut self, low: f64, high: f64) -> f64 {
        let range = high - low;
        low + range * self.next_f64()
    }

    /// `random_interval(max)`: uniform in `0..=max` by masked rejection.
    fn interval(&mut self, max: u64) -> u64 {
        if max == 0 {
            return 0;
        }
        let mut mask = max;
        for s in [1, 2, 4, 8, 16, 32] {
            mask |= mask >> s;
        }
        if max <= 0xffff_ffff {
            loop {
                let v = (self.next_u32() as u64) & mask;
                if v <= max {
                    return v;
                }
            }
        }
        loop {
            let v = self.next_u64() & mask;
            if v <= max {
                return v;
            }
        }
    }

    /// `RandomState.shuffle` of a 1-d array (Fisher-Yates from the end).
    pub fn shuffle<T>(&mut self, x: &mut [T]) {
        for i in (1..x.len()).rev() {
            let j = self.interval(i as u64) as usize;
            x.swap(i, j);
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Output {
    Softmax,
    Logistic,
}

/// A fitted classifier: `classes` ascending, as `classes_`.
#[derive(Debug, Clone)]
pub struct Mlp {
    pub classes: Vec<i64>,
    out: Output,
    w: [Array2<f64>; 2],
    b: [Array1<f64>; 2],
    pub n_iter: usize,
}

struct Adam {
    t: i32,
    m: Vec<Vec<f64>>,
    v: Vec<Vec<f64>>,
}

impl Adam {
    fn step(&mut self, params: [&mut [f64]; 4], grads: [&[f64]; 4]) {
        self.t += 1;
        let t = self.t as f64;
        let lr = LEARNING_RATE * (1.0 - BETA_2.powf(t)).sqrt() / (1.0 - BETA_1.powf(t));
        let update = |p: &mut [f64], g: &[f64], m: &mut [f64], v: &mut [f64]| {
            for i in 0..p.len() {
                m[i] = BETA_1 * m[i] + (1.0 - BETA_1) * g[i];
                v[i] = BETA_2 * v[i] + (1.0 - BETA_2) * (g[i] * g[i]);
                p[i] += (-lr * m[i]) / (v[i].sqrt() + EPSILON);
            }
        };
        for (k, (p, g)) in params.into_iter().zip(grads).enumerate() {
            let (m, v) = (&mut self.m[k], &mut self.v[k]);
            if p.len() < PAR_ELEMS {
                update(p, g, m, v);
            } else {
                const CHUNK: usize = 1 << 14;
                p.par_chunks_mut(CHUNK)
                    .zip(g.par_chunks(CHUNK))
                    .zip(m.par_chunks_mut(CHUNK))
                    .zip(v.par_chunks_mut(CHUNK))
                    .for_each(|(((p, g), m), v)| update(p, g, m, v));
            }
        }
    }
}

/// `a · b` (what `a.dot(&b)` computes), with big products split into row
/// blocks of `a` or column blocks of `b` (the longer side) run in parallel:
/// the sum behind each element is unchanged.
fn dot(a: ArrayView2<f64>, b: ArrayView2<f64>) -> Array2<f64> {
    let (m, k) = a.dim();
    let n = b.ncols();
    let threads = rayon::current_num_threads();
    if m * k * n < PAR_WORK || threads < 2 || m.max(n) < 32 {
        return a.dot(&b);
    }
    let mut out = Array2::<f64>::zeros((m, n));
    let blocks: Vec<(ArrayViewMut2<f64>, ArrayView2<f64>, ArrayView2<f64>)> = if n >= m {
        let chunk = n.div_ceil(threads).max(16);
        out.axis_chunks_iter_mut(Axis(1), chunk)
            .zip(b.axis_chunks_iter(Axis(1), chunk))
            .map(|(c, b)| (c, a, b))
            .collect()
    } else {
        let chunk = m.div_ceil(threads).max(16);
        out.axis_chunks_iter_mut(Axis(0), chunk)
            .zip(a.axis_chunks_iter(Axis(0), chunk))
            .map(|(c, a)| (c, a, b))
            .collect()
    };
    blocks
        .into_par_iter()
        .for_each(|(mut c, a, b)| general_mat_mul(1.0, &a, &b, 0.0, &mut c));
    out
}

/// `f` on every row, in parallel for a big matrix.
fn rows_each(a: &mut Array2<f64>, f: impl Fn(ndarray::ArrayViewMut1<f64>) + Sync) {
    if a.len() < PAR_ELEMS {
        a.rows_mut().into_iter().for_each(f);
        return;
    }
    let per = a.nrows().div_ceil(rayon::current_num_threads()).max(1);
    let blocks: Vec<ArrayViewMut2<f64>> = a.axis_chunks_iter_mut(Axis(0), per).collect();
    blocks
        .into_par_iter()
        .for_each(|mut b| b.rows_mut().into_iter().for_each(&f));
}

fn relu(a: &mut Array2<f64>) {
    a.mapv_inplace(|x| if x > 0.0 { x } else { 0.0 });
}

fn activate(out: Output, a: &mut Array2<f64>) {
    match out {
        Output::Softmax => {
            rows_each(a, |mut row| {
                let max = row.iter().copied().fold(f64::NEG_INFINITY, f64::max);
                row.mapv_inplace(|x| (x - max).exp());
                let sum: f64 = row.sum();
                row.mapv_inplace(|x| x / sum);
            });
        }
        Output::Logistic => a.mapv_inplace(|x| 1.0 / (1.0 + (-x).exp())),
    }
}

/// `log_loss` / `binary_log_loss` of a batch (for the stopping rule).
fn loss(out: Output, y: &Array2<f64>, p: &Array2<f64>) -> f64 {
    let eps = f64::EPSILON;
    let n = p.nrows() as f64;
    let xlogy = |a: f64, b: f64| if a == 0.0 { 0.0 } else { a * b.ln() };
    let mut total = 0.0;
    match out {
        Output::Softmax => {
            for c in 0..p.ncols() {
                let mut col = 0.0;
                for r in 0..p.nrows() {
                    col += xlogy(y[[r, c]], p[[r, c]].clamp(eps, 1.0 - eps));
                }
                total += col / n;
            }
        }
        Output::Logistic => {
            let mut col = 0.0;
            for r in 0..p.nrows() {
                let q = p[[r, 0]].clamp(eps, 1.0 - eps);
                col += xlogy(y[[r, 0]], q) + xlogy(1.0 - y[[r, 0]], 1.0 - q);
            }
            total = col / n;
        }
    }
    -total
}

impl Mlp {
    /// `MLPClassifier(...).fit(x, y)`. Errors carry sklearn's text.
    pub fn fit(x: ArrayView2<f64>, y: &[i64]) -> Result<Mlp, String> {
        let (n, d) = x.dim();
        if n == 0 {
            return Err(format!(
                "Found array with 0 sample(s) (shape=(0, {d})) while a minimum of 1 is required by MLPClassifier."
            ));
        }
        if d == 0 {
            return Err(format!(
                "Found array with 0 feature(s) (shape=({n}, 0)) while a minimum of 1 is required by MLPClassifier."
            ));
        }
        let mut classes = y.to_vec();
        classes.sort_unstable();
        classes.dedup();
        let (out, targets) = if classes.len() > 2 {
            let mut t = Array2::<f64>::zeros((n, classes.len()));
            for (r, label) in y.iter().enumerate() {
                let c = classes.binary_search(label).expect("class of y");
                t[[r, c]] = 1.0;
            }
            (Output::Softmax, t)
        } else {
            // LabelBinarizer: one column, 1 for the second class (all zeros
            // for a single class).
            let pos = classes.get(1).copied();
            let t = Array2::from_shape_fn((n, 1), |(r, _)| f64::from(Some(y[r]) == pos));
            (Output::Logistic, t)
        };
        let n_out = targets.ncols();

        let mut rng = Mt19937::new(SEED);
        let mut init = |fan_in: usize, fan_out: usize| {
            let bound = (6.0 / (fan_in + fan_out) as f64).sqrt();
            let w = Array2::from_shape_simple_fn((fan_in, fan_out), || rng.uniform(-bound, bound));
            let b = Array1::from_shape_simple_fn(fan_out, || rng.uniform(-bound, bound));
            (w, b)
        };
        let (w0, b0) = init(d, HIDDEN);
        let (w1, b1) = init(HIDDEN, n_out);
        let mut w = [w0, w1];
        let mut b = [b0, b1];
        let sizes = [d * HIDDEN, HIDDEN * n_out, HIDDEN, n_out];
        let mut adam = Adam {
            t: 0,
            m: sizes.iter().map(|s| vec![0.0; *s]).collect(),
            v: sizes.iter().map(|s| vec![0.0; *s]).collect(),
        };

        let batch = n.min(200);
        let mut idx: Vec<usize> = (0..n).collect();
        let mut best_loss = f64::INFINITY;
        let mut no_improvement = 0usize;
        let mut n_iter = 0;
        let mut xb = Array2::<f64>::zeros((batch, d));
        let mut yb = Array2::<f64>::zeros((batch, n_out));
        for _ in 0..MAX_ITER {
            // `sklearn.utils.shuffle(sample_idx)`: sample_idx[permutation].
            let mut perm: Vec<usize> = (0..n).collect();
            rng.shuffle(&mut perm);
            idx = perm.iter().map(|p| idx[*p]).collect();

            let mut accumulated = 0.0;
            for start in (0..n).step_by(batch) {
                let rows = &idx[start..(start + batch).min(n)];
                let nb = rows.len();
                let mut xv = xb.slice_mut(s![..nb, ..]);
                let mut yv = yb.slice_mut(s![..nb, ..]);
                for (r, &i) in rows.iter().enumerate() {
                    xv.row_mut(r).assign(&x.row(i));
                    yv.row_mut(r).assign(&targets.row(i));
                }
                let xv = xb.slice(s![..nb, ..]);
                let yv = yb.slice(s![..nb, ..]);

                let mut a1 = dot(xv, w[0].view()) + &b[0];
                relu(&mut a1);
                let mut a2 = dot(a1.view(), w[1].view()) + &b[1];
                activate(out, &mut a2);

                let mut batch_loss = loss(out, &yv.to_owned(), &a2);
                let values: f64 = w.iter().flat_map(|m| m.iter()).map(|v| v * v).sum();
                let nbf = nb as f64;
                batch_loss += (0.5 * ALPHA) * values / nbf;

                let delta2 = &a2 - &yv;
                let g1 = (dot(a1.t(), delta2.view()) + &(ALPHA * &w[1])) / nbf;
                let gb1 = delta2.sum_axis(Axis(0)) / nbf;
                let mut delta1 = dot(delta2.view(), w[1].t());
                ndarray::Zip::from(&mut delta1).and(&a1).for_each(|dl, a| {
                    if *a == 0.0 {
                        *dl = 0.0;
                    }
                });
                let g0 = (dot(xv.t(), delta1.view()) + &(ALPHA * &w[0])) / nbf;
                let gb0 = delta1.sum_axis(Axis(0)) / nbf;

                // Products of a single-column matrix can come out column-major.
                let (g0, g1) = (g0.as_standard_layout(), g1.as_standard_layout());
                accumulated += batch_loss * nbf;
                let [w0, w1] = &mut w;
                let [b0, b1] = &mut b;
                adam.step(
                    [
                        w0.as_slice_mut().expect("contiguous"),
                        w1.as_slice_mut().expect("contiguous"),
                        b0.as_slice_mut().expect("contiguous"),
                        b1.as_slice_mut().expect("contiguous"),
                    ],
                    [
                        g0.as_slice().expect("contiguous"),
                        g1.as_slice().expect("contiguous"),
                        gb0.as_slice().expect("contiguous"),
                        gb1.as_slice().expect("contiguous"),
                    ],
                );
            }
            n_iter += 1;
            let epoch_loss = accumulated / n as f64;
            if n_iter % 50 == 0 {
                tracing::debug!(
                    n,
                    classes = classes.len(),
                    epoch = n_iter,
                    loss = epoch_loss,
                    "mlp: training"
                );
            }
            if epoch_loss > best_loss - TOL {
                no_improvement += 1;
            } else {
                no_improvement = 0;
            }
            if epoch_loss < best_loss {
                best_loss = epoch_loss;
            }
            if no_improvement > N_ITER_NO_CHANGE {
                break;
            }
        }
        if !w.iter().all(|m| m.iter().all(|v| v.is_finite()))
            || !b.iter().all(|m| m.iter().all(|v| v.is_finite()))
        {
            return Err("Solver produced non-finite parameter weights. The input data may contain large values and need to be preprocessed.".into());
        }
        Ok(Mlp {
            classes,
            out,
            w,
            b,
            n_iter,
        })
    }

    /// `predict_proba`: one column per class, two for a logistic output
    /// (`[1 - p, p]`, even with a single class).
    pub fn predict_proba(&self, x: ArrayView2<f64>) -> Array2<f64> {
        let mut a1 = dot(x, self.w[0].view()) + &self.b[0];
        relu(&mut a1);
        let mut a2 = dot(a1.view(), self.w[1].view()) + &self.b[1];
        activate(self.out, &mut a2);
        match self.out {
            Output::Softmax => a2,
            Output::Logistic => Array2::from_shape_fn((a2.nrows(), 2), |(r, c)| {
                if c == 0 { 1.0 - a2[[r, 0]] } else { a2[[r, 0]] }
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn random_state_1_matches_numpy() {
        // np.random.RandomState(1).uniform(-0.1, 0.1, 3), then shuffle(arange(10)).
        let mut r = Mt19937::new(1);
        let u: Vec<f64> = (0..3).map(|_| r.uniform(-0.1, 0.1)).collect();
        assert!((u[0] - -0.0165956).abs() < 1e-7, "{u:?}");
        assert!((u[1] - 0.0440649).abs() < 1e-7, "{u:?}");
        assert!((u[2] - -0.09997713).abs() < 1e-8, "{u:?}");
        let mut a: Vec<usize> = (0..10).collect();
        r.shuffle(&mut a);
        assert_eq!(a, vec![3, 7, 6, 2, 9, 4, 1, 8, 0, 5]);
    }

    #[test]
    fn separates_two_blobs() {
        let x = Array2::from_shape_fn((40, 3), |(r, c)| {
            let base = if r < 20 { -1.0 } else { 1.0 };
            base + ((r * 7 + c * 3) % 5) as f64 * 0.05
        });
        let y: Vec<i64> = (0..40).map(|r| if r < 20 { 5 } else { 9 }).collect();
        let m = Mlp::fit(x.view(), &y).unwrap();
        assert_eq!(m.classes, vec![5, 9]);
        let p = m.predict_proba(x.view());
        assert!(p[[0, 0]] > 0.9 && p[[39, 1]] > 0.9, "{p:?}");
    }

    #[test]
    fn split_products_are_exact() {
        let a = Array2::from_shape_fn((200, 100), |(i, j)| {
            ((i * 31 + j * 17) % 97) as f64 / 97.0 - 0.5
        });
        let b = Array2::from_shape_fn((100, 3000), |(i, j)| {
            ((i * 13 + j * 7) % 89) as f64 / 89.0 - 0.5
        });
        assert_eq!(dot(a.view(), b.view()), a.dot(&b), "column blocks");
        let c = Array2::from_shape_fn((200, 3000), |(i, j)| {
            ((i * 7 + j * 3) % 83) as f64 / 83.0 - 0.5
        });
        assert_eq!(dot(c.view(), b.t()), c.dot(&b.t()), "row blocks");
        assert_eq!(dot(a.t(), c.view()), a.t().dot(&c), "transposed");
    }

    #[test]
    fn empty_is_sklearns_error() {
        let x = Array2::<f64>::zeros((0, 4));
        assert!(
            Mlp::fit(x.view(), &[])
                .unwrap_err()
                .starts_with("Found array with 0 sample(s)")
        );
    }
}
