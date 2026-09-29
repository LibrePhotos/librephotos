//! PCA for the face scatter plot of `/api/clusterfaces`, standing in for
//! scikit-learn's `PCA(n_components=3).fit_transform` until a face_cluster
//! sidecar offers it (none exists in `apps/backend/service/` yet).
//!
//! The data is centered and the top eigenvectors of the smaller of the
//! covariance (`XᵀX`, d×d) and Gram (`XXᵀ`, n×n) matrices are found by
//! orthogonal (block power) iteration with a Rayleigh-Ritz step. Signs follow
//! sklearn's `svd_flip(u_based_decision=False)`: the largest-magnitude entry
//! of each component is positive, so scores match sklearn up to float error.
//!
//! Unlike sklearn, fewer samples (or features) than components is not an
//! error: the missing components score 0.

/// `rows` (n samples × d features) projected on the top `k` components.
pub fn pca_scores(rows: &[Vec<f64>], k: usize) -> Vec<Vec<f64>> {
    let n = rows.len();
    if n == 0 {
        return Vec::new();
    }
    let d = rows[0].len();
    let mut mean = vec![0.0; d];
    for r in rows {
        for (m, v) in mean.iter_mut().zip(r) {
            *m += v;
        }
    }
    for m in &mut mean {
        *m /= n as f64;
    }
    let xc: Vec<Vec<f64>> = rows
        .iter()
        .map(|r| r.iter().zip(&mean).map(|(v, m)| v - m).collect())
        .collect();

    let covariance = d <= n;
    let m = d.min(n);
    let mat = if covariance {
        let mut c = vec![0.0; d * d];
        for r in &xc {
            for i in 0..d {
                let ri = r[i];
                if ri == 0.0 {
                    continue;
                }
                let row = &mut c[i * d..(i + 1) * d];
                for j in i..d {
                    row[j] += ri * r[j];
                }
            }
        }
        symmetrize(&mut c, d);
        c
    } else {
        let mut g = vec![0.0; n * n];
        for i in 0..n {
            for j in i..n {
                g[i * n + j] = dot(&xc[i], &xc[j]);
            }
        }
        symmetrize(&mut g, n);
        g
    };

    let kk = k.min(m);
    let (vals, vecs) = top_eigen(&mat, m, kk);
    let mut components: Vec<Vec<f64>> = Vec::with_capacity(kk);
    for (val, vec) in vals.iter().zip(&vecs) {
        let mut comp = if covariance {
            vec.clone()
        } else {
            // v = Xcᵀ u / |Xcᵀ u|
            let mut v = vec![0.0; d];
            for (r, ui) in xc.iter().zip(vec) {
                for (vj, rj) in v.iter_mut().zip(r) {
                    *vj += ui * rj;
                }
            }
            let norm = dot(&v, &v).sqrt();
            if norm > 0.0 && *val > 0.0 {
                v.iter_mut().for_each(|x| *x /= norm);
            } else {
                v.iter_mut().for_each(|x| *x = 0.0);
            }
            v
        };
        let mut best = 0;
        for (j, x) in comp.iter().enumerate() {
            if x.abs() > comp[best].abs() {
                best = j;
            }
        }
        if comp.get(best).is_some_and(|x| *x < 0.0) {
            comp.iter_mut().for_each(|x| *x = -*x);
        }
        components.push(comp);
    }
    xc.iter()
        .map(|r| {
            (0..k)
                .map(|i| components.get(i).map_or(0.0, |c| dot(r, c)))
                .collect()
        })
        .collect()
}

fn dot(a: &[f64], b: &[f64]) -> f64 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

fn symmetrize(a: &mut [f64], m: usize) {
    for i in 0..m {
        for j in 0..i {
            a[i * m + j] = a[j * m + i];
        }
    }
}

fn mat_vec(a: &[f64], m: usize, v: &[f64]) -> Vec<f64> {
    (0..m).map(|i| dot(&a[i * m..(i + 1) * m], v)).collect()
}

/// Orthonormalize `q` in place (modified Gram-Schmidt); columns that vanish
/// are replaced by fresh pseudo-random directions.
fn orthonormalize(q: &mut [Vec<f64>], seed: &mut u64) {
    for i in 0..q.len() {
        for attempt in 0..4 {
            let (done, rest) = q.split_at_mut(i);
            let v = &mut rest[0];
            for _ in 0..2 {
                for u in done.iter() {
                    let p = dot(u, v);
                    v.iter_mut().zip(u).for_each(|(x, y)| *x -= p * y);
                }
            }
            let norm = dot(v, v).sqrt();
            if norm > 1e-12 {
                v.iter_mut().for_each(|x| *x /= norm);
                break;
            }
            if attempt == 3 {
                v.iter_mut().for_each(|x| *x = 0.0);
                break;
            }
            v.iter_mut().for_each(|x| *x = next_rand(seed));
        }
    }
}

fn next_rand(seed: &mut u64) -> f64 {
    *seed = seed
        .wrapping_mul(6364136223846793005)
        .wrapping_add(1442695040888963407);
    ((*seed >> 11) as f64 / (1u64 << 53) as f64) - 0.5
}

/// Top `k` eigenpairs of the symmetric positive semi-definite `a` (m×m),
/// eigenvalues descending.
fn top_eigen(a: &[f64], m: usize, k: usize) -> (Vec<f64>, Vec<Vec<f64>>) {
    if k == 0 {
        return (Vec::new(), Vec::new());
    }
    let b = m.min(k + 6);
    let mut seed = 0x5eed_u64;
    let mut q: Vec<Vec<f64>> = (0..b)
        .map(|_| (0..m).map(|_| next_rand(&mut seed)).collect())
        .collect();
    orthonormalize(&mut q, &mut seed);
    let scale = (0..m)
        .map(|i| a[i * m + i])
        .sum::<f64>()
        .max(f64::MIN_POSITIVE);
    let mut ritz: (Vec<f64>, Vec<Vec<f64>>) = (Vec::new(), Vec::new());
    for _ in 0..3000 {
        let z: Vec<Vec<f64>> = q.iter().map(|v| mat_vec(a, m, v)).collect();
        // Rayleigh-Ritz on span(q): T = Qᵀ A Q.
        let mut t = vec![0.0; b * b];
        for i in 0..b {
            for j in 0..b {
                t[i * b + j] = dot(&q[i], &z[j]);
            }
        }
        symmetrize(&mut t, b);
        let (vals, w) = jacobi_eigen(&t, b);
        let vecs: Vec<Vec<f64>> = w
            .iter()
            .map(|wi| {
                let mut y = vec![0.0; m];
                for (c, qc) in wi.iter().zip(&q) {
                    y.iter_mut().zip(qc).for_each(|(x, qv)| *x += c * qv);
                }
                y
            })
            .collect();
        let converged = (0..k).all(|i| {
            let ay = mat_vec(a, m, &vecs[i]);
            let r: f64 = ay
                .iter()
                .zip(&vecs[i])
                .map(|(p, y)| (p - vals[i] * y).powi(2))
                .sum::<f64>()
                .sqrt();
            r <= 1e-11 * scale
        });
        ritz = (vals, vecs);
        if converged || b == m {
            break;
        }
        q = z;
        orthonormalize(&mut q, &mut seed);
    }
    let (vals, vecs) = ritz;
    (
        vals.into_iter().take(k).map(|v| v.max(0.0)).collect(),
        vecs.into_iter().take(k).collect(),
    )
}

/// Eigen-decomposition of a small symmetric matrix (cyclic Jacobi):
/// eigenvalues descending with their eigenvectors.
fn jacobi_eigen(t: &[f64], b: usize) -> (Vec<f64>, Vec<Vec<f64>>) {
    let mut a = t.to_vec();
    let mut v = vec![0.0; b * b];
    for i in 0..b {
        v[i * b + i] = 1.0;
    }
    for _sweep in 0..100 {
        let off: f64 = (0..b)
            .flat_map(|i| (0..b).filter(move |j| *j != i).map(move |j| (i, j)))
            .map(|(i, j)| a[i * b + j].powi(2))
            .sum();
        if off < 1e-30 {
            break;
        }
        for p in 0..b {
            for q in p + 1..b {
                let apq = a[p * b + q];
                if apq.abs() < 1e-300 {
                    continue;
                }
                let theta = (a[q * b + q] - a[p * b + p]) / (2.0 * apq);
                let tt = theta.signum() / (theta.abs() + (theta * theta + 1.0).sqrt());
                let tt = if theta == 0.0 { 1.0 } else { tt };
                let c = 1.0 / (tt * tt + 1.0).sqrt();
                let s = tt * c;
                for kx in 0..b {
                    let akp = a[kx * b + p];
                    let akq = a[kx * b + q];
                    a[kx * b + p] = c * akp - s * akq;
                    a[kx * b + q] = s * akp + c * akq;
                }
                for kx in 0..b {
                    let apk = a[p * b + kx];
                    let aqk = a[q * b + kx];
                    a[p * b + kx] = c * apk - s * aqk;
                    a[q * b + kx] = s * apk + c * aqk;
                }
                for kx in 0..b {
                    let vkp = v[kx * b + p];
                    let vkq = v[kx * b + q];
                    v[kx * b + p] = c * vkp - s * vkq;
                    v[kx * b + q] = s * vkp + c * vkq;
                }
            }
        }
    }
    let mut order: Vec<usize> = (0..b).collect();
    order.sort_by(|x, y| a[y * b + y].total_cmp(&a[x * b + x]));
    let vals = order.iter().map(|&i| a[i * b + i]).collect();
    let vecs = order
        .iter()
        .map(|&i| (0..b).map(|r| v[r * b + i]).collect())
        .collect();
    (vals, vecs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn two_dimensional_line() {
        // Points on y = 2x: one component carries everything.
        let rows: Vec<Vec<f64>> = (0..5).map(|i| vec![i as f64, 2.0 * i as f64]).collect();
        let s = pca_scores(&rows, 3);
        let norm = (1.0f64 + 4.0).sqrt();
        for (i, r) in s.iter().enumerate() {
            let expected = (i as f64 - 2.0) * norm;
            assert!((r[0] - expected).abs() < 1e-9, "{r:?}");
            assert!(r[1].abs() < 1e-9);
            assert_eq!(r[2], 0.0);
        }
    }

    #[test]
    fn gram_and_covariance_agree() {
        let mut seed = 7u64;
        let rows: Vec<Vec<f64>> = (0..6)
            .map(|_| (0..4).map(|_| next_rand(&mut seed)).collect())
            .collect();
        let wide: Vec<Vec<f64>> = rows
            .iter()
            .map(|r| {
                let mut w = r.clone();
                w.extend([0.0; 6]);
                w
            })
            .collect();
        let a = pca_scores(&rows, 3);
        let b = pca_scores(&wide, 3);
        for (x, y) in a.iter().zip(&b) {
            for (p, q) in x.iter().zip(y) {
                assert!((p - q).abs() < 1e-8, "{a:?} vs {b:?}");
            }
        }
    }

    #[test]
    fn single_sample() {
        assert_eq!(pca_scores(&[vec![1.0, 2.0]], 3), vec![vec![0.0, 0.0, 0.0]]);
    }
}
