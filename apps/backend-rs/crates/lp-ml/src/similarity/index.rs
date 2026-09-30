//! A flat inner-product index (FAISS `IndexFlatIP`) over 512-d f32 CLIP
//! embeddings, and its on-disk form.
//!
//! File `similarity/<user_id>.f32`: the header `LPSIMF32`, `u32` version,
//! `u32` dim, `u64` n (little-endian), then `n * dim` f32 LE, then the `n`
//! image hashes joined by `\n`. Vectors and hashes in one file so they can
//! never disagree; it is written to a temporary name and renamed into place.

use std::cmp::Ordering;
use std::io::{Read, Seek, SeekFrom, Write};
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

    /// The `i`-th stored vector.
    pub fn vector(&self, i: usize) -> &[f32] {
        &self.data[i * EMBEDDING_SIZE..(i + 1) * EMBEDDING_SIZE]
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
    /// best first, ties listed by descending position as the sidecar's
    /// `sorted(zip(dist, idx), reverse=True)` does. The threshold is compared
    /// in f32, as numpy 2 compares `np.float32 >= float`.
    ///
    /// Of exactly equal scores straddling the `n` cut, the lower positions
    /// (hash order) are kept. FAISS keeps whichever its heap (n < 100) or
    /// reservoir (n >= 100) happens to hold, which depends on the scan order
    /// of every other score; only such exact ties (duplicate embeddings)
    /// can come out as different members of the same score group.
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
        let threshold = threshold as f32;
        let scores = self.scores(query);
        let mut hits: Vec<(f32, usize)> = scores
            .into_iter()
            .enumerate()
            .filter(|(_, s)| *s >= threshold)
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
        let mut out = Vec::with_capacity(HEADER + self.data.len() * 4 + self.hashes.len() * 34);
        self.write_to(&mut out).expect("writing to a Vec");
        out
    }

    fn write_to(&self, out: &mut impl Write) -> std::io::Result<()> {
        out.write_all(MAGIC)?;
        out.write_all(&VERSION.to_le_bytes())?;
        out.write_all(&(EMBEDDING_SIZE as u32).to_le_bytes())?;
        out.write_all(&(self.len() as u64).to_le_bytes())?;
        let mut buf = Vec::with_capacity(EMBEDDING_SIZE * 4);
        for v in self.data.chunks(EMBEDDING_SIZE) {
            buf.clear();
            for x in v {
                buf.extend_from_slice(&x.to_le_bytes());
            }
            out.write_all(&buf)?;
        }
        for (i, h) in self.hashes.iter().enumerate() {
            if i > 0 {
                out.write_all(b"\n")?;
            }
            out.write_all(h.as_bytes())?;
        }
        Ok(())
    }

    pub fn from_bytes(bytes: &[u8]) -> anyhow::Result<FlatIndex> {
        FlatIndex::read_from(&mut std::io::Cursor::new(bytes), bytes.len() as u64)
    }

    /// Parse an index of `file_len` bytes; the vectors are converted as they
    /// are read, so loading takes the index's size in memory, not twice it.
    fn read_from(r: &mut impl Read, file_len: u64) -> anyhow::Result<FlatIndex> {
        let mut head = [0u8; HEADER];
        r.read_exact(&mut head)
            .map_err(|_| anyhow!("not a similarity index"))?;
        let n =
            usize::try_from(parse_header(&head)?).map_err(|_| anyhow!("index size overflows"))?;
        let body = body_len(n as u64).ok_or_else(|| anyhow!("index size overflows"))?;
        if file_len < HEADER as u64 + body {
            bail!(
                "truncated: {} vectors need {} bytes",
                n,
                HEADER as u64 + body
            );
        }
        let mut data = vec![0f32; n * EMBEDDING_SIZE];
        let mut buf = vec![0u8; EMBEDDING_SIZE * 4];
        for v in data.chunks_mut(EMBEDDING_SIZE) {
            r.read_exact(&mut buf)?;
            for (x, c) in v.iter_mut().zip(buf.chunks_exact(4)) {
                *x = f32::from_le_bytes([c[0], c[1], c[2], c[3]]);
            }
        }
        let mut text = String::new();
        r.read_to_string(&mut text).context("image hashes")?;
        let hashes = split_hashes(&text, n)?;
        Ok(FlatIndex { data, hashes })
    }

    pub fn read(path: &Path) -> anyhow::Result<FlatIndex> {
        let f = std::fs::File::open(path).with_context(|| format!("reading {}", path.display()))?;
        let len = f.metadata()?.len();
        FlatIndex::read_from(&mut std::io::BufReader::with_capacity(1 << 16, f), len)
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
        let tmp = tempfile::Builder::new()
            .prefix(&prefix)
            .suffix(".tmp")
            .tempfile_in(dir)
            .with_context(|| format!("creating a temporary file in {}", dir.display()))?;
        let mut w = std::io::BufWriter::with_capacity(1 << 16, tmp);
        self.write_to(&mut w)?;
        let tmp = w.into_inner().map_err(|e| e.into_error())?;
        tmp.as_file().sync_all()?;
        tmp.persist(path)
            .map_err(|e| anyhow!("replacing {}: {}", path.display(), e.error))?;
        Ok(())
    }
}

fn body_len(n: u64) -> Option<u64> {
    n.checked_mul((EMBEDDING_SIZE * 4) as u64)
}

fn split_hashes(text: &str, n: usize) -> anyhow::Result<Vec<String>> {
    let hashes: Vec<String> = if n == 0 && text.is_empty() {
        Vec::new()
    } else {
        text.split('\n').map(str::to_string).collect()
    };
    if hashes.len() != n {
        bail!("{n} vectors for {} image hashes", hashes.len());
    }
    Ok(hashes)
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

/// The vector count of a stored index, reading its header and hash list
/// (not the vectors); `None` when the file is missing, not an index, too
/// short for its vectors, or holds another number of hashes (a torn or
/// damaged file the startup check should rebuild).
pub fn stored_len(path: &Path) -> Option<u64> {
    let mut f = std::fs::File::open(path).ok()?;
    let mut head = [0u8; HEADER];
    f.read_exact(&mut head).ok()?;
    let n = parse_header(&head).ok()?;
    let vectors_end = (HEADER as u64).checked_add(body_len(n)?)?;
    if f.metadata().ok()?.len() < vectors_end {
        return None;
    }
    f.seek(SeekFrom::Start(vectors_end)).ok()?;
    let mut text = String::new();
    f.read_to_string(&mut text).ok()?;
    split_hashes(&text, usize::try_from(n).ok()?).ok()?;
    Some(n)
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
    fn threshold_compares_in_f32() {
        let mut idx = FlatIndex::new();
        let mut e = vec![0f32; EMBEDDING_SIZE];
        e[0] = 27.0;
        idx.add(&["h".to_string()], &[e]).unwrap();
        let mut q = vec![0f32; EMBEDDING_SIZE];
        q[0] = 1.0;
        // np.float32(27.0) >= 27.0000001 is True under numpy 2 (NEP 50).
        assert_eq!(idx.search(&q, 10, 27.000_000_1).unwrap(), vec!["h"]);
        assert!(idx.search(&q, 10, 27.01).unwrap().is_empty());
    }

    #[test]
    fn stored_len_rejects_a_torn_file() {
        let dir = tempfile::tempdir().unwrap();
        let p = path(dir.path(), 3);
        let mut idx = FlatIndex::new();
        idx.add(&["a".into(), "b".into()], &[v(1), v(2)]).unwrap();
        idx.write(&p).unwrap();
        assert_eq!(stored_len(&p), Some(2));
        let bytes = std::fs::read(&p).unwrap();
        assert_eq!(FlatIndex::read(&p).unwrap(), idx);
        // The vectors whole but the hash list cut short.
        std::fs::write(&p, &bytes[..bytes.len() - 2]).unwrap();
        assert_eq!(stored_len(&p), None);
        assert!(FlatIndex::read(&p).is_err());
        std::fs::write(&p, &bytes[..HEADER + EMBEDDING_SIZE * 4]).unwrap();
        assert_eq!(stored_len(&p), None);
        assert!(FlatIndex::read(&p).is_err());
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
