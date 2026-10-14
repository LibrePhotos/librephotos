//! `dupes.detect`: `batch_detect_duplicates`. Exact copies share an
//! `image_hash` or a file MD5; visual duplicates are pHash neighbours within
//! the threshold, found with a 4-block multi-index over the 64-bit hashes
//! (a BK-tree for other lengths) instead of Django's O(n^2) cross-batch pass
//! (same pairs, same groups). New groups are written in bulk. One transaction.

use std::collections::HashMap;
use std::hash::Hash;

use anyhow::Context;
use indexmap::IndexMap;
use lp_core::AppState;
use lp_db::stats_admin_stacks_dupes::detect;
use lp_db::stats_admin_stacks_dupes::dupes::{EXACT_COPY, VISUAL_DUPLICATE};
use lp_db::write::stats_admin_stacks_dupes::dupes as write;
use serde_json::Value;
use uuid::Uuid;

use super::phash::{BkTree, BlockIndex, MAX_DISTANCE, PHash};
use super::{option_flag, progress};
use crate::stats_admin_stacks_dupes::paging::json_int;

/// Union-find with path compression and union by rank; groups come out in
/// first-seen order like Django's `UnionFind.get_groups`.
#[derive(Default)]
pub struct UnionFind<T: Hash + Eq + Clone> {
    index: IndexMap<T, usize>,
    parent: Vec<usize>,
    rank: Vec<u8>,
}

impl<T: Hash + Eq + Clone> UnionFind<T> {
    fn slot(&mut self, x: &T) -> usize {
        if let Some(&i) = self.index.get(x) {
            return i;
        }
        let i = self.parent.len();
        self.index.insert(x.clone(), i);
        self.parent.push(i);
        self.rank.push(0);
        i
    }

    fn root(&mut self, mut i: usize) -> usize {
        while self.parent[i] != i {
            self.parent[i] = self.parent[self.parent[i]];
            i = self.parent[i];
        }
        i
    }

    pub fn union(&mut self, a: &T, b: &T) {
        let (a, b) = (self.slot(a), self.slot(b));
        let (mut ra, mut rb) = (self.root(a), self.root(b));
        if ra == rb {
            return;
        }
        if self.rank[ra] < self.rank[rb] {
            std::mem::swap(&mut ra, &mut rb);
        }
        self.parent[rb] = ra;
        if self.rank[ra] == self.rank[rb] {
            self.rank[ra] += 1;
        }
    }

    /// Groups of two or more.
    pub fn groups(mut self) -> Vec<Vec<T>> {
        let mut by_root: IndexMap<usize, Vec<T>> = IndexMap::new();
        let items: Vec<(T, usize)> = self.index.iter().map(|(k, &i)| (k.clone(), i)).collect();
        for (item, i) in items {
            let r = self.root(i);
            by_root.entry(r).or_default().push(item);
        }
        by_root.into_values().filter(|g| g.len() > 1).collect()
    }
}

/// Pairs within `threshold` among `hashes` (by position). Unparsable hashes
/// sit at distance 64 from everything, as in Django.
pub fn visual_pairs(hashes: &[&str], threshold: i64) -> Vec<(usize, usize)> {
    let mut pairs = Vec::new();
    for_each_visual_pair(hashes, threshold, |i, j| pairs.push((i, j)));
    pairs
}

/// [`visual_pairs`] without collecting them: a large threshold pairs nearly
/// everything, and n² pairs of a big library would not fit in memory.
pub fn for_each_visual_pair(hashes: &[&str], threshold: i64, mut f: impl FnMut(usize, usize)) {
    if threshold < 0 {
        return;
    }
    if threshold >= i64::from(MAX_DISTANCE) {
        // Everything within 64 of everything else: no pruning is possible.
        let parsed: Vec<Option<PHash>> = hashes.iter().map(|h| PHash::parse(h)).collect();
        for i in 0..parsed.len() {
            for j in 0..i {
                let d = match (&parsed[i], &parsed[j]) {
                    (Some(a), Some(b)) => a.distance(b),
                    _ => MAX_DISTANCE,
                };
                if i64::from(d) <= threshold {
                    f(i, j);
                }
            }
        }
        return;
    }
    let threshold = threshold as u32;
    let parsed: Vec<Option<PHash>> = hashes.iter().map(|h| PHash::parse(h)).collect();
    // 64-bit hashes (all of Django's) are searched in parallel; other
    // lengths keep one BK-tree each.
    let mut words: Vec<u64> = Vec::new();
    let mut global = Vec::new();
    let mut trees: HashMap<usize, BkTree> = HashMap::new();
    let mut found = Vec::new();
    for (i, p) in parsed.into_iter().enumerate() {
        let Some(p) = p else {
            continue;
        };
        if hashes[i].len() == 16 {
            global.push(i);
            words.push(p.word());
            continue;
        }
        found.clear();
        let tree = trees.entry(hashes[i].len()).or_default();
        tree.search(&p, threshold, &mut found);
        found.sort_unstable();
        for &j in &found {
            f(i, j);
        }
        tree.insert(p, i);
    }
    for_each_earlier_neighbour(&words, threshold, |i, j| f(global[i], global[j]));
}

/// Every pair `(i, j)`, `j < i`, of 64-bit hashes within `threshold`, in
/// order: through the block index at small radii, by popcount against every
/// earlier hash otherwise. Items are searched in parallel, a slice at a time
/// so that a radius pairing nearly everything cannot exhaust memory.
fn for_each_earlier_neighbour(words: &[u64], threshold: u32, mut f: impl FnMut(usize, usize)) {
    use rayon::prelude::*;
    if words.is_empty() {
        return;
    }
    let index = BlockIndex::supports(threshold).then(|| BlockIndex::new(words, threshold));
    let variants = index.as_ref().map(BlockIndex::variants).unwrap_or_default();
    let slice = ((1usize << 24) / words.len()).max(64);
    for start in (0..words.len()).step_by(slice) {
        let end = (start + slice).min(words.len());
        let lists: Vec<Vec<u32>> = (start..end)
            .into_par_iter()
            .map(|i| match &index {
                Some(index) => {
                    let mut out = Vec::new();
                    index.earlier_neighbours(words, i, threshold, &variants, &mut out);
                    out
                }
                None => {
                    let h = words[i];
                    (0..i as u32)
                        .filter(|&j| (h ^ words[j as usize]).count_ones() <= threshold)
                        .collect()
                }
            })
            .collect();
        for (k, list) in lists.into_iter().enumerate() {
            for j in list {
                f(start + k, j as usize);
            }
        }
    }
}

pub async fn detect(
    state: &AppState,
    user_id: i32,
    options: &Value,
    lrj: Option<&str>,
) -> anyhow::Result<usize> {
    lp_db::users::by_id(&state.db, user_id)
        .await?
        .with_context(|| format!("user {user_id} not found"))?;
    let detect_exact = option_flag(options, "detect_exact_copies", true);
    let detect_visual = option_flag(options, "detect_visual_duplicates", true);
    let threshold = options
        .get("visual_threshold")
        .and_then(json_int)
        .unwrap_or(10);
    let mut lap = Laps::new();
    let mut tx = state.db.begin().await?;
    if option_flag(options, "clear_pending", false) {
        write::clear_pending(&mut tx, user_id).await?;
    }
    let mut found = 0usize;
    if detect_exact {
        let by_hash = detect::same_image_hash_groups(&mut tx, user_id).await?;
        let by_content = detect::same_content_groups(&mut tx, user_id).await?;
        lap.mark("exact_inputs");
        let total = by_hash.len() + by_content.len();
        progress(state, lrj, "exact_copies", 0, total, 0).await;
        let mut uf = UnionFind::default();
        for group in by_hash.iter().chain(&by_content) {
            for other in &group[1..] {
                uf.union(&group[0], other);
            }
        }
        found += write::create_or_merge_many(&mut tx, user_id, EXACT_COPY, &uf.groups()).await?;
        lap.mark("exact_writes");
        progress(state, lrj, "exact_copies", total, total, found).await;
    }
    if detect_visual {
        let candidates = detect::visual_candidates(&mut tx, user_id).await?;
        lap.mark("visual_inputs");
        let total = candidates.len();
        if total >= 2 {
            progress(state, lrj, "visual_duplicates", 0, total, 0).await;
            let pairs = state
                .blocking(move || {
                    let hashes: Vec<&str> = candidates.iter().map(|(_, h)| h.as_str()).collect();
                    let mut uf = UnionFind::default();
                    let mut pair_count = 0usize;
                    for_each_visual_pair(&hashes, threshold, |a, b| {
                        pair_count += 1;
                        uf.union(&candidates[a].0, &candidates[b].0);
                    });
                    (pair_count, uf.groups())
                })
                .await?;
            let (pair_count, groups): (usize, Vec<Vec<Uuid>>) = pairs;
            lap.mark("visual_pairs");
            tracing::info!(
                user_id,
                candidates = total,
                pairs = pair_count,
                groups = groups.len(),
                "dupes.detect: visual pairs"
            );
            found +=
                write::create_or_merge_many(&mut tx, user_id, VISUAL_DUPLICATE, &groups).await?;
            lap.mark("visual_writes");
            progress(state, lrj, "visual_duplicates", total, total, pair_count).await;
        }
    }
    tx.commit().await?;
    lap.mark("commit");
    tracing::info!(user_id, found, stages = %lap, "dupes.detect: done");
    Ok(found)
}

/// Stage timings for the job log line (`stage=ms ...`).
struct Laps {
    last: std::time::Instant,
    marks: Vec<(&'static str, u128)>,
}

impl Laps {
    fn new() -> Self {
        Laps {
            last: std::time::Instant::now(),
            marks: Vec::new(),
        }
    }

    fn mark(&mut self, stage: &'static str) {
        let now = std::time::Instant::now();
        self.marks
            .push((stage, now.duration_since(self.last).as_millis()));
        self.last = now;
    }
}

impl std::fmt::Display for Laps {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        for (i, (stage, ms)) in self.marks.iter().enumerate() {
            write!(f, "{}{stage}={ms}ms", if i == 0 { "" } else { " " })?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stats_admin_stacks_dupes::jobs::phash::hamming;

    /// `cargo test -p lp-api --lib --release pair_search_speed -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn pair_search_speed() {
        let mut state = 0x9e37_79b9_7f4a_7c15u64;
        let hashes: Vec<String> = (0..50_000)
            .map(|_| {
                state ^= state << 13;
                state ^= state >> 7;
                state ^= state << 17;
                format!("{state:016x}")
            })
            .collect();
        let refs: Vec<&str> = hashes.iter().map(String::as_str).collect();
        for threshold in [10, 20] {
            let t = std::time::Instant::now();
            let mut n = 0usize;
            for_each_visual_pair(&refs, threshold, |_, _| n += 1);
            println!("threshold {threshold}: {n} pairs in {:?}", t.elapsed());
        }
        // The BK-tree this replaced, at the default radius.
        let t = std::time::Instant::now();
        let (mut tree, mut found, mut n) = (BkTree::default(), Vec::new(), 0usize);
        for (i, h) in refs.iter().enumerate() {
            let p = PHash::parse(h).unwrap();
            found.clear();
            tree.search(&p, 10, &mut found);
            n += found.len();
            tree.insert(p, i);
        }
        println!("bk-tree threshold 10: {n} pairs in {:?}", t.elapsed());
    }

    #[test]
    fn union_find_groups() {
        let mut uf = UnionFind::default();
        uf.union(&1, &2);
        uf.union(&3, &4);
        uf.union(&2, &4);
        uf.union(&5, &5);
        assert_eq!(uf.groups(), vec![vec![1, 2, 3, 4]]);
    }

    #[test]
    fn pairs_match_brute_force() {
        let mut state = 0x1234_5678_9abc_def0u64;
        let mut next = || {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            state
        };
        let base = next();
        let wide: Vec<String> = (0..3)
            .map(|_| format!("{base:016x}{:016x}{base:016x}{:016x}", next(), next()))
            .collect();
        let hashes: Vec<String> = (0..300)
            .map(|i| {
                let flips = next() & next() & next();
                let v = if i % 3 == 0 { next() } else { base ^ flips };
                format!("{v:016x}")
            })
            .chain(["bogus".to_string(), "ab".to_string()])
            .chain((0..4).map(|i| format!("{:016x}", base ^ (0x3 << (i * 16)))))
            .chain(wide)
            .collect();
        let refs: Vec<&str> = hashes.iter().map(String::as_str).collect();
        for threshold in [0, 3, 5, 10, 13, 15, 20] {
            let mut got: Vec<(usize, usize)> = visual_pairs(&refs, threshold)
                .into_iter()
                .map(|(a, b)| (a.max(b), a.min(b)))
                .collect();
            got.sort();
            let mut want = Vec::new();
            for i in 0..refs.len() {
                for j in 0..i {
                    if i64::from(hamming(refs[i], refs[j])) <= threshold {
                        want.push((i, j));
                    }
                }
            }
            assert_eq!(got, want, "threshold {threshold}");
        }
    }
}
