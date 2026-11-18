//! Decode scheduling: a bounded worker pool with two LIFO lanes (screen/full before thumbs, newest
//! first), deduplication of identical in-flight requests, and an LRU of encoded thumb/screen
//! responses keyed by (path, mtime, kind, w, h).

use std::collections::HashMap;
use std::panic::AssertUnwindSafe;
use std::path::PathBuf;
use std::sync::{Arc, Condvar, Mutex};

use crate::cache::LruCache;
use crate::decode::{self, RenderError};
use crate::listing::modified_ms;
use crate::pixels::Encoded;
use crate::request::Kind;

pub const DEFAULT_WORKERS: usize = 6;
pub const DEFAULT_CACHE_BYTES: usize = 256 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Key {
    pub path: PathBuf,
    pub mtime: i64,
    pub kind: Kind,
    pub w: u32,
    pub h: u32,
}

pub type Reply = Result<Arc<Encoded>, RenderError>;
pub type Waiter = Box<dyn FnOnce(Reply) + Send>;

#[derive(Default)]
struct State {
    high: Vec<Key>,
    low: Vec<Key>,
    inflight: HashMap<Key, Vec<Waiter>>,
    busy_low: usize,
}

struct Inner {
    state: Mutex<State>,
    cv: Condvar,
    cache: Mutex<LruCache<Key, Arc<Encoded>>>,
    workers: usize,
}

#[derive(Clone)]
pub struct Pipeline {
    inner: Arc<Inner>,
}

fn cacheable(kind: Kind) -> bool {
    kind != Kind::Full
}

impl Pipeline {
    pub fn new(workers: usize, cache_bytes: usize) -> Pipeline {
        let workers = workers.max(2);
        let inner = Arc::new(Inner {
            state: Mutex::new(State::default()),
            cv: Condvar::new(),
            cache: Mutex::new(LruCache::new(cache_bytes)),
            workers,
        });
        for i in 0..workers {
            let inner = inner.clone();
            std::thread::Builder::new()
                .name(format!("lpview-decode-{i}"))
                .spawn(move || worker(inner))
                .expect("spawn decode worker");
        }
        Pipeline { inner }
    }

    /// Queue a request; `waiter` is called exactly once (inline on a cache hit).
    pub fn submit(&self, path: PathBuf, kind: Kind, w: u32, h: u32, waiter: Waiter) {
        let mtime = match std::fs::metadata(&path) {
            Ok(m) if m.is_file() => modified_ms(&m),
            _ => {
                return waiter(Err(RenderError::NotFound(format!(
                    "{} not found",
                    path.display()
                ))));
            }
        };
        let key = Key {
            path,
            mtime,
            kind,
            w,
            h,
        };
        if cacheable(kind)
            && let Some(hit) = self.inner.cache.lock().unwrap().get(&key)
        {
            return waiter(Ok(hit));
        }
        let mut st = self.inner.state.lock().unwrap();
        if let Some(ws) = st.inflight.get_mut(&key) {
            ws.push(waiter);
            // Asked again: move it to the top of its lane (it is wanted now).
            let lane = if kind == Kind::Thumb {
                &mut st.low
            } else {
                &mut st.high
            };
            if let Some(i) = lane.iter().position(|k| *k == key) {
                let k = lane.remove(i);
                lane.push(k);
            }
            return;
        }
        st.inflight.insert(key.clone(), vec![waiter]);
        if kind == Kind::Thumb {
            st.low.push(key);
        } else {
            st.high.push(key);
        }
        drop(st);
        self.inner.cv.notify_one();
    }

    /// Blocking variant (bench, tests, clipboard).
    pub fn get(&self, path: PathBuf, kind: Kind, w: u32, h: u32) -> Reply {
        let (tx, rx) = std::sync::mpsc::channel();
        self.submit(path, kind, w, h, Box::new(move |r| _ = tx.send(r)));
        rx.recv()
            .unwrap_or_else(|_| Err(RenderError::Failed("pipeline stopped".into())))
    }

    pub fn cache_stats(&self) -> (usize, usize) {
        let c = self.inner.cache.lock().unwrap();
        (c.len(), c.bytes())
    }
}

/// Decode one request synchronously (no cache, no pool).
pub fn render_now(key: &Key) -> Result<Encoded, RenderError> {
    let r = std::panic::catch_unwind(AssertUnwindSafe(|| {
        let r = decode::render(&key.path, key.kind, key.w, key.h)?;
        decode::finish(&key.path, r).map_err(RenderError::Failed)
    }));
    r.unwrap_or_else(|_| Err(RenderError::Failed("decoder panicked".into())))
}

fn worker(inner: Arc<Inner>) {
    loop {
        let (key, low) = {
            let mut st = inner.state.lock().unwrap();
            loop {
                if let Some(k) = st.high.pop() {
                    break (k, false);
                }
                // Thumbs never take the last worker: a `screen` request always finds one free.
                if st.busy_low + 1 < inner.workers
                    && let Some(k) = st.low.pop()
                {
                    st.busy_low += 1;
                    break (k, true);
                }
                st = inner.cv.wait(st).unwrap();
            }
        };
        let reply: Reply = render_now(&key).map(Arc::new);
        if let Ok(e) = &reply
            && cacheable(key.kind)
        {
            inner
                .cache
                .lock()
                .unwrap()
                .insert(key.clone(), e.clone(), e.bytes.len() + 256);
        }
        let waiters = {
            let mut st = inner.state.lock().unwrap();
            if low {
                st.busy_low -= 1;
            }
            st.inflight.remove(&key).unwrap_or_default()
        };
        if low {
            inner.cv.notify_one();
        }
        for w in waiters {
            w(reply.clone());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_png(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("lpview-pipe-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join(name);
        let img = image::RgbImage::from_pixel(64, 48, image::Rgb([10, 200, 30]));
        img.save(&p).unwrap();
        p
    }

    #[test]
    fn dedupes_caches_and_reports_missing() {
        let pipe = Pipeline::new(3, 1 << 20);
        let p = temp_png("a.png");
        let (tx, rx) = std::sync::mpsc::channel();
        for _ in 0..5 {
            let tx = tx.clone();
            pipe.submit(
                p.clone(),
                Kind::Screen,
                32,
                32,
                Box::new(move |r| _ = tx.send(r)),
            );
        }
        let replies: Vec<_> = (0..5).map(|_| rx.recv().unwrap().unwrap()).collect();
        assert_eq!((replies[0].width, replies[0].height), (32, 24));
        assert!(
            replies.iter().all(|r| Arc::ptr_eq(r, &replies[0])),
            "one decode shared by all"
        );
        assert_eq!(pipe.cache_stats().0, 1);
        let again = pipe.get(p.clone(), Kind::Screen, 32, 32).unwrap();
        assert!(Arc::ptr_eq(&again, &replies[0]), "served from cache");
        let full = pipe.get(p.clone(), Kind::Full, u32::MAX, u32::MAX).unwrap();
        assert_eq!(full.mime, "image/png");
        assert_eq!(pipe.cache_stats().0, 1, "full is not cached");
        let missing = pipe.get(p.with_file_name("nope.png"), Kind::Thumb, 320, 320);
        assert!(matches!(missing, Err(RenderError::NotFound(_))));
    }

    #[test]
    fn screen_requests_never_wait_behind_thumbs() {
        let dir = std::env::temp_dir().join(format!("lpview-prio-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        // Noisy PNGs big enough that each thumb takes a while to decode.
        let mut img = image::RgbImage::new(1500, 1500);
        for (i, p) in img.pixels_mut().enumerate() {
            let v = (i as u32).wrapping_mul(2654435761);
            *p = image::Rgb([v as u8, (v >> 8) as u8, (v >> 16) as u8]);
        }
        let files: Vec<PathBuf> = (0..8)
            .map(|i| {
                let p = dir.join(format!("t{i}.png"));
                img.save(&p).unwrap();
                p
            })
            .collect();
        let pipe = Pipeline::new(2, 1 << 20);
        let (tx, rx) = std::sync::mpsc::channel();
        for (i, f) in files.iter().enumerate() {
            let tx = tx.clone();
            pipe.submit(
                f.clone(),
                Kind::Thumb,
                320,
                320,
                Box::new(move |r| _ = tx.send((format!("thumb{i}"), r.is_ok()))),
            );
        }
        let tx2 = tx.clone();
        pipe.submit(
            files[0].clone(),
            Kind::Screen,
            100,
            100,
            Box::new(move |r| _ = tx2.send(("screen".into(), r.is_ok()))),
        );
        let order: Vec<(String, bool)> = (0..9).map(|_| rx.recv().unwrap()).collect();
        assert!(order.iter().all(|(_, ok)| *ok));
        let pos = order.iter().position(|(n, _)| n == "screen").unwrap();
        assert!(pos <= 2, "screen finished at position {pos}: {order:?}");
        // Thumbs are LIFO: the newest (thumb7) is served before older queued ones (thumb1;
        // thumb0 may already be running when the rest arrive).
        let p7 = order.iter().position(|(n, _)| n == "thumb7").unwrap();
        let p1 = order.iter().position(|(n, _)| n == "thumb1").unwrap();
        assert!(p7 < p1, "{order:?}");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn unsupported_and_corrupt_files() {
        let pipe = Pipeline::new(2, 1 << 20);
        let dir = temp_png("b.png").parent().unwrap().to_path_buf();
        let txt = dir.join("notes.txt");
        std::fs::write(&txt, "hi").unwrap();
        assert!(matches!(
            pipe.get(txt, Kind::Thumb, 320, 320),
            Err(RenderError::Unsupported(_))
        ));
        let bad = dir.join("bad.tif");
        std::fs::write(&bad, b"II*\0garbage").unwrap();
        assert!(matches!(
            pipe.get(bad, Kind::Screen, 100, 100),
            Err(RenderError::Failed(_))
        ));
    }
}
