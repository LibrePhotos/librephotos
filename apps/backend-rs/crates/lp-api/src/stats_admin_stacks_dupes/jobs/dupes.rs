//! `dupes.detect`: `batch_detect_duplicates`. Exact copies share an
//! `image_hash` or a file MD5; visual duplicates are pHash neighbours within
//! the threshold, found with one BK-tree per hash length instead of Django's
//! O(n^2) cross-batch pass (same pairs, same groups). One transaction.

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

use super::phash::{BkTree, MAX_DISTANCE, PHash};
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
    let mut trees: HashMap<usize, BkTree> = HashMap::new();
    let mut found = Vec::new();
    for (i, h) in hashes.iter().enumerate() {
        let Some(parsed) = PHash::parse(h) else {
            continue;
        };
        let tree = trees.entry(h.len()).or_default();
        found.clear();
        tree.search(&parsed, threshold, &mut found);
        for &j in &found {
            f(i, j);
        }
        tree.insert(parsed, i);
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
    let mut tx = state.db.begin().await?;
    if option_flag(options, "clear_pending", false) {
        write::clear_pending(&mut tx, user_id).await?;
    }
    let mut found = 0usize;
    if detect_exact {
        let by_hash = detect::same_image_hash_groups(&mut tx, user_id).await?;
        let by_content = detect::same_content_groups(&mut tx, user_id).await?;
        let total = by_hash.len() + by_content.len();
        progress(state, lrj, "exact_copies", 0, total, 0).await;
        let mut uf = UnionFind::default();
        for group in by_hash.iter().chain(&by_content) {
            for other in &group[1..] {
                uf.union(&group[0], other);
            }
        }
        for group in uf.groups() {
            if write::create_or_merge(&mut tx, user_id, EXACT_COPY, &group, None)
                .await?
                .is_some()
            {
                found += 1;
            }
        }
        progress(state, lrj, "exact_copies", total, total, found).await;
    }
    if detect_visual {
        let candidates = detect::visual_candidates(&mut tx, user_id).await?;
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
            let mut created = 0usize;
            for group in groups {
                if write::create_or_merge(&mut tx, user_id, VISUAL_DUPLICATE, &group, None)
                    .await?
                    .is_some()
                {
                    created += 1;
                }
            }
            found += created;
            progress(state, lrj, "visual_duplicates", total, total, pair_count).await;
        }
    }
    tx.commit().await?;
    Ok(found)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stats_admin_stacks_dupes::jobs::phash::hamming;

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
        let hashes: Vec<String> = (0..300)
            .map(|i| {
                let flips = next() & next() & next();
                let v = if i % 3 == 0 { next() } else { base ^ flips };
                format!("{v:016x}")
            })
            .chain(["bogus".to_string(), "ab".to_string()])
            .collect();
        let refs: Vec<&str> = hashes.iter().map(String::as_str).collect();
        for threshold in [0, 5, 10, 20] {
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
