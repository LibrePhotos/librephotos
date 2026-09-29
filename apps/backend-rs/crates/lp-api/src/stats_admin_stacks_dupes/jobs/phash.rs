//! Perceptual hash distance (`api.perceptual_hash.hamming_distance`) and a
//! BK-tree over it for the duplicate search.

/// Distance Django reports for hashes it cannot compare.
pub const MAX_DISTANCE: u32 = 64;

/// A hex pHash as bits. `imagehash.hex_to_hash` reads a square bit matrix,
/// so only lengths whose bit count is a perfect square are hashes.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct PHash {
    len: usize,
    words: Vec<u64>,
}

impl PHash {
    pub fn parse(hex: &str) -> Option<PHash> {
        let bits = hex.len() * 4;
        let side = (bits as f64).sqrt() as usize;
        if hex.is_empty() || side * side != bits || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
            return None;
        }
        let words = hex
            .as_bytes()
            .chunks(16)
            .map(|c| u64::from_str_radix(std::str::from_utf8(c).unwrap_or("0"), 16).unwrap_or(0))
            .collect();
        Some(PHash {
            len: hex.len(),
            words,
        })
    }

    pub fn distance(&self, other: &PHash) -> u32 {
        if self.len != other.len {
            return MAX_DISTANCE;
        }
        self.words
            .iter()
            .zip(&other.words)
            .map(|(a, b)| (a ^ b).count_ones())
            .sum()
    }
}

/// `hamming_distance(hash1, hash2)`.
pub fn hamming(a: &str, b: &str) -> u32 {
    match (PHash::parse(a), PHash::parse(b)) {
        (Some(a), Some(b)) => a.distance(&b),
        _ => MAX_DISTANCE,
    }
}

/// Burkhard-Keller tree of equal-length hashes (a true metric space).
#[derive(Default)]
pub struct BkTree {
    nodes: Vec<BkNode>,
}

struct BkNode {
    hash: PHash,
    item: usize,
    /// (distance to this node, child node index)
    children: Vec<(u32, usize)>,
}

impl BkTree {
    pub fn insert(&mut self, hash: PHash, item: usize) {
        if self.nodes.is_empty() {
            self.nodes.push(BkNode {
                hash,
                item,
                children: Vec::new(),
            });
            return;
        }
        let mut at = 0;
        loop {
            let d = self.nodes[at].hash.distance(&hash);
            match self.nodes[at].children.iter().find(|(dist, _)| *dist == d) {
                Some(&(_, child)) => at = child,
                None => {
                    let idx = self.nodes.len();
                    self.nodes.push(BkNode {
                        hash,
                        item,
                        children: Vec::new(),
                    });
                    self.nodes[at].children.push((d, idx));
                    return;
                }
            }
        }
    }

    /// Items within `threshold` of `hash`.
    pub fn search(&self, hash: &PHash, threshold: u32, out: &mut Vec<usize>) {
        if self.nodes.is_empty() {
            return;
        }
        let mut stack = vec![0usize];
        while let Some(at) = stack.pop() {
            let node = &self.nodes[at];
            let d = node.hash.distance(hash);
            if d <= threshold {
                out.push(node.item);
            }
            let lo = d.saturating_sub(threshold);
            let hi = d + threshold;
            stack.extend(
                node.children
                    .iter()
                    .filter(|(cd, _)| *cd >= lo && *cd <= hi)
                    .map(|(_, c)| *c),
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn distances() {
        assert_eq!(hamming("ffffffffffffffff", "fffffffffffffffe"), 1);
        assert_eq!(hamming("0000000000000000", "ffffffffffffffff"), 64);
        assert_eq!(hamming("abc", "abc"), 64);
        assert_eq!(hamming("zzzzzzzzzzzzzzzz", "0000000000000000"), 64);
        assert_eq!(hamming(&"f".repeat(64), &"0".repeat(64)), 256);
        assert_eq!(hamming(&"f".repeat(64), &"f".repeat(16)), 64);
    }

    #[test]
    fn bk_tree_finds_neighbours() {
        let hs = [
            "0000000000000000",
            "0000000000000001",
            "00000000000000ff",
            "ffffffffffffffff",
        ];
        let mut t = BkTree::default();
        for (i, h) in hs.iter().enumerate() {
            t.insert(PHash::parse(h).unwrap(), i);
        }
        let mut out = Vec::new();
        t.search(&PHash::parse("0000000000000000").unwrap(), 1, &mut out);
        out.sort();
        assert_eq!(out, [0, 1]);
        out.clear();
        t.search(&PHash::parse("0000000000000000").unwrap(), 8, &mut out);
        out.sort();
        assert_eq!(out, [0, 1, 2]);
    }
}
