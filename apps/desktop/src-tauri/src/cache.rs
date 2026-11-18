//! Byte-budgeted LRU cache.

use std::collections::{BTreeMap, HashMap};
use std::hash::Hash;

pub struct LruCache<K, V> {
    map: HashMap<K, (V, u64, usize)>,
    order: BTreeMap<u64, K>,
    tick: u64,
    bytes: usize,
    budget: usize,
}

impl<K: Hash + Eq + Clone, V: Clone> LruCache<K, V> {
    pub fn new(budget: usize) -> Self {
        LruCache {
            map: HashMap::new(),
            order: BTreeMap::new(),
            tick: 0,
            bytes: 0,
            budget,
        }
    }

    pub fn get(&mut self, k: &K) -> Option<V> {
        let (v, t, _) = self.map.get_mut(k)?;
        self.order.remove(t);
        self.tick += 1;
        *t = self.tick;
        self.order.insert(self.tick, k.clone());
        Some(v.clone())
    }

    /// Insert `v` costing `size` bytes; evicts least recently used entries over budget.
    /// Values larger than a quarter of the budget are not cached.
    pub fn insert(&mut self, k: K, v: V, size: usize) {
        if size > self.budget / 4 {
            return;
        }
        self.remove(&k);
        self.tick += 1;
        self.order.insert(self.tick, k.clone());
        self.map.insert(k, (v, self.tick, size));
        self.bytes += size;
        while self.bytes > self.budget {
            let Some((_, old)) = self.order.pop_first() else {
                break;
            };
            if let Some((_, _, s)) = self.map.remove(&old) {
                self.bytes -= s;
            }
        }
    }

    pub fn remove(&mut self, k: &K) {
        if let Some((_, t, s)) = self.map.remove(k) {
            self.order.remove(&t);
            self.bytes -= s;
        }
    }

    pub fn len(&self) -> usize {
        self.map.len()
    }

    pub fn is_empty(&self) -> bool {
        self.map.is_empty()
    }

    pub fn bytes(&self) -> usize {
        self.bytes
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn evicts_least_recently_used_over_budget() {
        let mut c = LruCache::new(100);
        c.insert("a", 1, 20);
        c.insert("b", 2, 20);
        c.insert("c", 3, 20);
        assert_eq!(c.get(&"a"), Some(1)); // a is now most recent
        c.insert("d", 4, 25);
        c.insert("e", 5, 25); // 110 > 100: evict b (oldest)
        assert_eq!(c.get(&"b"), None);
        assert_eq!(c.get(&"a"), Some(1));
        assert_eq!(c.bytes(), 90);
        assert_eq!(c.len(), 4);
    }

    #[test]
    fn replaces_and_skips_huge() {
        let mut c = LruCache::new(100);
        c.insert("a", 1, 10);
        c.insert("a", 2, 15);
        assert_eq!((c.get(&"a"), c.bytes(), c.len()), (Some(2), 15, 1));
        c.insert("big", 9, 26);
        assert_eq!(c.get(&"big"), None);
        c.remove(&"a");
        assert!(c.is_empty());
        assert_eq!(c.bytes(), 0);
    }
}
