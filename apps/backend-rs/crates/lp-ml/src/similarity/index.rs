//! A flat inner-product index (FAISS `IndexFlatIP`) over 512-d f32 CLIP
//! embeddings, and its on-disk form.
//!
//! File `similarity/<user_id>.f32`: the header `LPSIMF32`, `u32` version,
//! `u32` dim, `u64` n (little-endian), then `n * dim` f32 LE, then the `n`
//! image hashes joined by `\n`. Vectors and hashes in one file so they can
//! never disagree; it is written to a temporary name and renamed into place.

use std::cmp::Ordering;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use anyhow::{Context, anyhow, bail};
use rayon::prelude::*;

/// `embedding_size` of `retrieval_index.py`.
pub const EMBEDDING_SIZE: usize = 512;
const MAGIC: &[u8; 8] = b"LPSIMF32";
const VERSION: u32 = 1;
const HEADER: usize = 8 + 4 + 4 + 8;
/// Above this many vectors a search fans out over the rayon pool.
const PARALLEL_FROM: usize = 16_384;

#[derive(Debug, Clone, Default, PartialEq)]
pub struct FlatIndex {
    data: Vec<f32>,
    hashes: Vec<String>,
}

impl FlatIndex {
    pub fn new() -> Self {
        FlatIndex::default()
    }

    /// `ntotal`.
    pub fn len(&self) -> usize {
        self.hashes.len()
    }

    pub fn is_empty(&self) -> bool {
        self.hashes.is_empty()
    }

    pub fn hashes(&self) -> &[String] {
        &self.hashes
    }

    /// Append vectors; every one must have [`EMBEDDING_SIZE`] components.
    pub fn add(&mut self, hashes: &[String], embeddings: &[Vec<f32>]) -> anyhow::Result<()> {
        if hashes.len() != embeddings.len() {
            bail!(
                "{} image hashes for {} embeddings",
                hashes.len(),
                embeddings.len()
            );
        }
        if let Some(bad) = embeddings.iter().find(|e| e.len() != EMBEDDING_SIZE) {
            bail!(
                "embeddings of the wrong shape: expected embedding size {EMBEDDING_SIZE}, got {}",
                bad.len()
            );
        }
        self.data.reserve(embeddings.len() * EMBEDDING_SIZE);
        for e in embeddings {
            self.data.extend_from_slice(e);
        }
        self.hashes.extend(hashes.iter().cloned());
        Ok(())
    }

    /// Inner product of `query` with every stored vector, in index order.
    pub fn scores(&self, query: &[f32]) -> Vec<f32> {
        if self.len() >= PARALLEL_FROM {
            self.data
                .par_chunks_exact(EMBEDDING_SIZE)
                .map(|v| dot(v, query))
                .collect()
        } else {
            self.data
                .chunks_exact(EMBEDDING_SIZE)
                .map(|v| dot(v, query))
                .collect()
        }
    }

    /// `search_similar`: the `n` best inner products that reach `threshold`,
    /// best first. As FAISS + the sidecar's `sorted(zip(dist, idx),
    /// reverse=True)`: of equal scores the lower positions (hash order) make
    /// the cut, and the result lists ties by descending position.
    pub fn search(&self, query: &[f32], n: usize, threshold: f64) -> anyhow::Result<Vec<String>> {
        if query.len() != EMBEDDING_SIZE {
            bail!(
                "query embedding has {} components, the index {EMBEDDING_SIZE}",
                query.len()
            );
        }
        if n == 0 || self.is_empty() {
            return Ok(Vec::new());
        }
        let scores = self.scores(query);
        let mut hits: Vec<(f32, usize)> = scores
            .into_iter()
            .enumerate()
            .filter(|(_, s)| f64::from(*s) >= threshold)
            .map(|(i, s)| (s, i))
            .collect();
        let best_first = |a: &(f32, usize), b: &(f32, usize)| {
            b.0.partial_cmp(&a.0)
                .unwrap_or(Ordering::Equal)
                .then(a.1.cmp(&b.1))
        };
        if hits.len() > n {
            hits.select_nth_unstable_by(n - 1, best_first);
            hits.truncate(n);
        }
        hits.sort_unstable_by(|a, b| {
            b.0.partial_cmp(&a.0)
                .unwrap_or(Ordering::Equal)
                .then(b.1.cmp(&a.1))
        });
        Ok(hits
            .into_iter()
            .map(|(_, i)| self.hashes[i].clone())
            .collect())
    }

    // ---- persistence ---------------------------------------------------------

    pub fn to_bytes(&self) -> Vec<u8> {
        let hashes = self.hashes.join("\n");
        let mut out = Vec::with_capacity(HEADER + self.data.len() * 4 + hashes.len());
        out.extend_from_slice(MAGIC);
        out.extend_from_slice(&VERSION.to_le_bytes());
        out.extend_from_slice(&(EMBEDDING_SIZE as u32).to_le_bytes());
        out.extend_from_slice(&(self.len() as u64).to_le_bytes());
        for v in &self.data {
            out.extend_from_slice(&v.to_le_bytes());
        }
        out.extend_from_slice(hashes.as_bytes());
        out
    }

    pub fn from_bytes(bytes: &[u8]) -> anyhow::Result<FlatIndex> {
        let n = parse_header(bytes)? as usize;
        let body = n
            .checked_mul(EMBEDDING_SIZE * 4)
            .ok_or_else(|| anyhow!("index size overflows"))?;
        if bytes.len() < HEADER + body {
            bail!("truncated: {} vectors need {} bytes", n, HEADER + body);
        }
        let data: Vec<f32> = bytes[HEADER..HEADER + body]
            .chunks_exact(4)
            .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
            .collect();
        let text = std::str::from_utf8(&bytes[HEADER + body..]).context("image hashes")?;
        let hashes: Vec<String> = if n == 0 {
            Vec::new()
        } else {
            text.split('\n').map(str::to_string).collect()
        };
        if hashes.len() != n {
            bail!("{n} vectors for {} image hashes", hashes.len());
        }
        Ok(FlatIndex { data, hashes })
    }

    pub fn read(path: &Path) -> anyhow::Result<FlatIndex> {
        let bytes = std::fs::read(path).with_context(|| format!("reading {}", path.display()))?;
        FlatIndex::from_bytes(&bytes)
            .with_context(|| format!("similarity index {}", path.display()))
    }

    /// Write atomically (temporary file in the same directory, fsync, rename).
    pub fn write(&self, path: &Path) -> anyhow::Result<()> {
        let dir = path
            .parent()
            .ok_or_else(|| anyhow!("no parent directory"))?;
        std::fs::create_dir_all(dir).with_context(|| format!("creating {}", dir.display()))?;
        let prefix = format!(
            ".{}.",
            path.file_stem().and_then(|s| s.to_str()).unwrap_or("index")
        );
        let mut tmp = tempfile::Builder::new()
            .prefix(&prefix)
            .suffix(".tmp")
            .tempfile_in(dir)
            .with_context(|| format!("creating a temporary file in {}", dir.display()))?;
        tmp.write_all(&self.to_bytes())?;
        tmp.as_file().sync_all()?;
        tmp.persist(path)
            .map_err(|e| anyhow!("replacing {}: {}", path.display(), e.error))?;
        Ok(())
    }
}

fn parse_header(bytes: &[u8]) -> anyhow::Result<u64> {
    if bytes.len() < HEADER || &bytes[..8] != MAGIC {
        bail!("not a similarity index");
    }
    let u32_at =
        |o: usize| u32::from_le_bytes([bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]]);
    let version = u32_at(8);
    if version != VERSION {
        bail!("unsupported version {version}");
    }
    let dim = u32_at(12) as usize;
    if dim != EMBEDDING_SIZE {
        bail!("dimension {dim}, expected {EMBEDDING_SIZE}");
    }
    let mut n = [0u8; 8];
    n.copy_from_slice(&bytes[16..24]);
    Ok(u64::from_le_bytes(n))
}

/// The vector count of a stored index, reading only its header.
pub fn stored_len(path: &Path) -> Option<u64> {
    let mut f = std::fs::File::open(path).ok()?;
    let mut head = [0u8; HEADER];
    f.read_exact(&mut head).ok()?;
    parse_header(&head).ok()
}

/// `<dir>/<user_id>.f32`.
pub fn path(dir: &Path, user_id: i32) -> PathBuf {
    dir.join(format!("{user_id}.f32"))
}

/// f32 inner product exactly as FAISS 1.15's AVX2 `fvec_inner_product`
/// computes it (verified bit for bit): 8 lanes, multiply then add (no FMA),
/// lanes reduced by halves. Near-equal neighbours then rank as in FAISS.
#[inline]
pub fn dot(a: &[f32], b: &[f32]) -> f32 {
    const L: usize = 8;
    let mut acc = [0f32; L];
    let ca = a.chunks_exact(L);
    let cb = b.chunks_exact(L);
    let (ra, rb) = (ca.remainder(), cb.remainder());
    for (x, y) in ca.zip(cb) {
        for ((s, x), y) in acc.iter_mut().zip(x).zip(y) {
            *s += x * y;
        }
    }
    let h: [f32; 4] = std::array::from_fn(|i| acc[i] + acc[i + 4]);
    let q = [h[0] + h[2], h[1] + h[3]];
    let mut s = q[0] + q[1];
    for (x, y) in ra.iter().zip(rb) {
        s += x * y;
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(seed: u32) -> Vec<f32> {
        (0..EMBEDDING_SIZE)
            .map(|i| (((i as u32).wrapping_mul(2654435761) ^ seed) % 1000) as f32 / 100.0 - 5.0)
            .collect()
    }

    #[test]
    fn roundtrip_and_search_order() {
        let mut idx = FlatIndex::new();
        let hashes: Vec<String> = (0..5).map(|i| format!("h{i}")).collect();
        let mut embs: Vec<Vec<f32>> = (0..5).map(v).collect();
        embs[3] = embs[1].clone();
        idx.add(&hashes, &embs).unwrap();
        let back = FlatIndex::from_bytes(&idx.to_bytes()).unwrap();
        assert_eq!(back, idx);
        let all = idx.search(&embs[1], 10, f64::MIN).unwrap();
        assert_eq!(all.len(), 5);
        // The tie of h1 and h3 lists the later position first.
        assert_eq!(&all[..2], &["h3".to_string(), "h1".to_string()]);
        // n = 1 keeps the earlier of the tie.
        assert_eq!(idx.search(&embs[1], 1, f64::MIN).unwrap(), vec!["h1"]);
        assert!(idx.search(&embs[1], 10, 1e12).unwrap().is_empty());
        assert!(idx.search(&[0.0; 3], 10, 0.0).is_err());
    }

    #[test]
    fn empty_index_roundtrips() {
        let idx = FlatIndex::new();
        assert_eq!(FlatIndex::from_bytes(&idx.to_bytes()).unwrap().len(), 0);
    }

    #[test]
    fn dot_matches_f64_reference() {
        let (a, b) = (v(1), v(2));
        let exact: f64 = a
            .iter()
            .zip(&b)
            .map(|(x, y)| f64::from(*x) * f64::from(*y))
            .sum();
        assert!((f64::from(dot(&a, &b)) - exact).abs() < 1e-2);
    }
}
