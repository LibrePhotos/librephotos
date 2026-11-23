//! `api/social_graph.py::_spring_layout` (Fruchterman-Reingold, vendored
//! from NetworkX) with numpy's `default_rng(42)` start positions, so the
//! coordinates match Django's for the same node order.

/// `np.random.default_rng(seed)`: SeedSequence -> PCG64 (XSL-RR 128/64).
pub struct NumpyRng {
    state: u128,
    inc: u128,
}

const PCG_MULT: u128 = 0x2360_ED05_1FC6_5DA4_4385_DF64_9FCC_F645;

impl NumpyRng {
    pub fn new(seed: u32) -> Self {
        let words = seed_sequence_state(seed, 8);
        let w = |i: usize| (words[2 * i] as u64) | ((words[2 * i + 1] as u64) << 32);
        let initstate = ((w(0) as u128) << 64) | w(1) as u128;
        let initseq = ((w(2) as u128) << 64) | w(3) as u128;
        let mut rng = NumpyRng {
            state: 0,
            inc: (initseq << 1) | 1,
        };
        rng.step();
        rng.state = rng.state.wrapping_add(initstate);
        rng.step();
        rng
    }

    fn step(&mut self) {
        self.state = self.state.wrapping_mul(PCG_MULT).wrapping_add(self.inc);
    }

    pub fn next_u64(&mut self) -> u64 {
        self.step();
        let s = self.state;
        let rot = (s >> 122) as u32;
        (((s >> 64) as u64) ^ (s as u64)).rotate_right(rot)
    }

    /// `Generator.random()`: a double in [0, 1).
    pub fn random(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 * (1.0 / 9007199254740992.0)
    }
}

/// `SeedSequence(seed).generate_state(n_words, np.uint32)` (pool size 4).
fn seed_sequence_state(seed: u32, n_words: usize) -> Vec<u32> {
    const INIT_A: u32 = 0x43b0_d7e5;
    const MULT_A: u32 = 0x931e_8875;
    const INIT_B: u32 = 0x8b51_f9dd;
    const MULT_B: u32 = 0x58f3_8ded;
    const MIX_MULT_L: u32 = 0xca01_f9dd;
    const MIX_MULT_R: u32 = 0x4973_f715;
    const XSHIFT: u32 = 16;

    let mut hash_const = INIT_A;
    let mut hashmix = |value: u32| {
        let mut v = value ^ hash_const;
        hash_const = hash_const.wrapping_mul(MULT_A);
        v = v.wrapping_mul(hash_const);
        v ^ (v >> XSHIFT)
    };
    let mix = |x: u32, y: u32| {
        let r = MIX_MULT_L
            .wrapping_mul(x)
            .wrapping_sub(MIX_MULT_R.wrapping_mul(y));
        r ^ (r >> XSHIFT)
    };
    let entropy = [seed];
    let mut pool = [0u32; 4];
    for (i, slot) in pool.iter_mut().enumerate() {
        *slot = hashmix(entropy.get(i).copied().unwrap_or(0));
    }
    for src in 0..4 {
        for dst in 0..4 {
            if src != dst {
                let h = hashmix(pool[src]);
                pool[dst] = mix(pool[dst], h);
            }
        }
    }
    let mut hash_const = INIT_B;
    (0..n_words)
        .map(|i| {
            let mut v = pool[i % 4] ^ hash_const;
            hash_const = hash_const.wrapping_mul(MULT_B);
            v = v.wrapping_mul(hash_const);
            v ^ (v >> XSHIFT)
        })
        .collect()
}

/// Positions for nodes `0..n` with undirected `edges`, same operation order
/// as the numpy code (so results agree to the bit).
pub fn spring_layout(
    n: usize,
    edges: &[(usize, usize)],
    k: f64,
    scale: f64,
    iterations: usize,
) -> Vec<[f64; 2]> {
    if n == 0 {
        return Vec::new();
    }
    let mut rng = NumpyRng::new(42);
    let mut pos: Vec<[f64; 2]> = (0..n)
        .map(|_| {
            let x = rng.random() * 2.0 - 1.0;
            let y = rng.random() * 2.0 - 1.0;
            [x, y]
        })
        .collect();
    let mut t = (n as f64 * 0.1).max(0.1);
    let dt = t / (iterations as f64 + 1.0);
    let k2 = k.powi(2);
    let mut delta = vec![[0.0f64; 2]; n * n];
    let mut dist = vec![0.0f64; n * n];
    for _ in 0..iterations {
        for i in 0..n {
            for j in 0..n {
                let d = [pos[i][0] - pos[j][0], pos[i][1] - pos[j][1]];
                delta[i * n + j] = d;
                dist[i * n + j] = if i == j {
                    1e-10
                } else {
                    (d[0] * d[0] + d[1] * d[1]).sqrt()
                };
            }
        }
        let mut disp = vec![[0.0f64; 2]; n];
        for (i, out) in disp.iter_mut().enumerate() {
            for j in 0..n {
                let dd = dist[i * n + j];
                let f = k2 / (dd * dd);
                let d = delta[i * n + j];
                out[0] += f * d[0];
                out[1] += f * d[1];
            }
        }
        for &(a, b) in edges {
            let d = delta[a * n + b];
            let f = dist[a * n + b] / k;
            let att = [f * d[0], f * d[1]];
            disp[a][0] -= att[0];
            disp[a][1] -= att[1];
            disp[b][0] += att[0];
            disp[b][1] += att[1];
        }
        for i in 0..n {
            let norm = (disp[i][0] * disp[i][0] + disp[i][1] * disp[i][1]).sqrt();
            let norm = if norm < 1e-10 { 1e-10 } else { norm };
            let m = norm.min(t);
            pos[i][0] += disp[i][0] / norm * m;
            pos[i][1] += disp[i][1] / norm * m;
        }
        t -= dt;
    }
    let lim = pos
        .iter()
        .flat_map(|p| [p[0].abs(), p[1].abs()])
        .fold(f64::NEG_INFINITY, f64::max);
    if lim > 0.0 {
        for p in &mut pos {
            p[0] = p[0] * scale / lim;
            p[1] = p[1] * scale / lim;
        }
    }
    pos
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `np.random.default_rng(42).random(4)`.
    #[test]
    fn matches_numpy_default_rng() {
        let mut rng = NumpyRng::new(42);
        let got: Vec<f64> = (0..4).map(|_| rng.random()).collect();
        assert_eq!(
            got,
            [
                0.7739560485559633,
                0.4388784397520523,
                0.8585979199113825,
                0.6973680290593639
            ]
        );
    }

    /// `_spring_layout(G, k=1/2, scale=1000, iterations=20)` on
    /// A-E, A-B, A-C, C-D (nodes in insertion order A..E).
    #[test]
    fn matches_numpy_layout() {
        let pos = spring_layout(5, &[(0, 4), (0, 1), (0, 2), (2, 3)], 0.5, 1000.0, 20);
        let want = [
            [156.16926535868353, -135.8732480032553],
            [583.3819943859511, -480.6075020405267],
            [46.998111779127974, 461.0244182304551],
            [-46.95727549681218, 1000.0],
            [-236.57591733769553, -540.5093180493473],
        ];
        for (got, want) in pos.iter().zip(want) {
            for c in 0..2 {
                assert!((got[c] - want[c]).abs() < 1e-9, "{got:?} vs {want:?}");
            }
        }
    }
}
