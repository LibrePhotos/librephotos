use std::collections::HashMap;
use std::panic::AssertUnwindSafe;
use std::path::PathBuf;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use crate::cache::LruCache;
use crate::decode::{self, RenderError, Rendered};
use crate::diskcache::DiskCache;
use crate::formats::{FileKind, ext_of, kind_of_ext};
use crate::listing::modified_ms;
use crate::pixels::Encoded;
pub use crate::request::Priority;
use crate::request::{Kind, THUMB_EDGE};

pub const DEFAULT_WORKERS: usize = 6;
pub const DEFAULT_CACHE_BYTES: usize = 256 * 1024 * 1024;
pub const IDLE_WORKERS: usize = 2;
const PROBE_THREADS: usize = 2;
const DISK_MIN_RENDER: Duration = Duration::from_millis(12);

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

struct Job {
    waiters: Vec<Waiter>,
    size: u64,
    prio: Priority,
    queued: bool,
}

const LANES: usize = 3;

#[derive(Default)]
struct State {
    probe: Vec<Key>,
    lanes: [Vec<Key>; LANES],
    inflight: HashMap<Key, Job>,
    busy: [usize; LANES],
}

#[derive(Debug, PartialEq, Eq)]
enum Wake {
    Workers,
    Probe,
    Nobody,
}

impl State {
    fn enqueue(
        &mut self,
        key: Key,
        size: u64,
        prio: Priority,
        waiter: Waiter,
        probe: bool,
    ) -> Wake {
        if let Some(job) = self.inflight.get_mut(&key) {
            job.waiters.push(waiter);
            let (old, queued) = (job.prio, job.queued);
            let new = old.min(prio);
            job.prio = new;
            trace("joined", &key, new, "");
            if !queued {
                return Wake::Nobody;
            }
            let from = &mut self.lanes[lane(old)];
            if let Some(i) = from.iter().position(|k| *k == key) {
                let k = from.remove(i);
                self.lanes[lane(new)].push(k);
            }
            return Wake::Workers;
        }
        trace("queued", &key, prio, if probe { "probe" } else { "" });
        self.inflight.insert(
            key.clone(),
            Job {
                waiters: vec![waiter],
                size,
                prio,
                queued: !probe,
            },
        );
        if probe {
            self.probe.push(key);
            Wake::Probe
        } else {
            self.lanes[lane(prio)].push(key);
            Wake::Workers
        }
    }

    fn finish(&mut self, key: &Key, ran_as: Priority) -> Option<Job> {
        self.busy[lane(ran_as)] -= 1;
        self.inflight.remove(key)
    }
}

struct Inner {
    state: Mutex<State>,
    cv: Condvar,
    probe_cv: Condvar,
    cache: Mutex<LruCache<Key, Arc<Encoded>>>,
    disk: Option<DiskCache>,
    disk_min_render: Duration,
    workers: usize,
}

#[derive(Clone)]
pub struct Pipeline {
    inner: Arc<Inner>,
}

fn cacheable(kind: Kind) -> bool {
    kind != Kind::Full
}

fn lane(p: Priority) -> usize {
    p as usize
}

fn disk_id(key: &Key, size: u64) -> String {
    format!(
        "{:?}|{}x{}|{}|{}|{}",
        key.kind,
        key.w,
        key.h,
        key.mtime,
        size,
        key.path.display()
    )
}

fn trace_on() -> bool {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ON.get_or_init(|| std::env::var_os("LPVIEW_TRACE").is_some())
}

fn trace(event: &str, key: &Key, prio: Priority, extra: &str) {
    static T0: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();
    if !trace_on() {
        return;
    }
    let t = T0.get_or_init(Instant::now).elapsed().as_secs_f64() * 1000.0;
    let name = key.path.file_name().unwrap_or_default().to_string_lossy();
    eprintln!(
        "lpview {t:9.1} {event:<7} {:?}/{prio:?} {name} {extra}",
        key.kind
    );
}

impl Pipeline {
    pub fn new(workers: usize, cache_bytes: usize) -> Pipeline {
        Pipeline::with_disk(workers, cache_bytes, None)
    }

    pub fn with_disk(workers: usize, cache_bytes: usize, disk: Option<DiskCache>) -> Pipeline {
        Pipeline::with_disk_after(workers, cache_bytes, disk, DISK_MIN_RENDER)
    }

    pub fn with_disk_after(
        workers: usize,
        cache_bytes: usize,
        disk: Option<DiskCache>,
        disk_min_render: Duration,
    ) -> Pipeline {
        let workers = workers.max(2);
        let probes = if disk.is_some() { PROBE_THREADS } else { 0 };
        let inner = Arc::new(Inner {
            state: Mutex::new(State::default()),
            cv: Condvar::new(),
            probe_cv: Condvar::new(),
            cache: Mutex::new(LruCache::new(cache_bytes)),
            disk,
            disk_min_render,
            workers,
        });
        for i in 0..workers {
            let inner = inner.clone();
            std::thread::Builder::new()
                .name(format!("lpview-decode-{i}"))
                .spawn(move || worker(inner))
                .expect("spawn decode worker");
        }
        for i in 0..probes {
            let inner = inner.clone();
            std::thread::Builder::new()
                .name(format!("lpview-disk-{i}"))
                .spawn(move || prober(inner))
                .expect("spawn disk reader");
        }
        Pipeline { inner }
    }

    pub fn submit(&self, path: PathBuf, kind: Kind, w: u32, h: u32, waiter: Waiter) {
        let prio = if kind == Kind::Thumb {
            Priority::Low
        } else {
            Priority::High
        };
        self.submit_with(path, kind, w, h, prio, waiter);
    }

    pub fn submit_with(
        &self,
        path: PathBuf,
        kind: Kind,
        w: u32,
        h: u32,
        prio: Priority,
        waiter: Waiter,
    ) {
        let (mtime, size) = match std::fs::metadata(&path) {
            Ok(m) if m.is_file() => (modified_ms(&m), m.len()),
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
            trace("memory", &key, prio, "");
            return waiter(Ok(hit));
        }
        let probe = self.inner.disk.is_some() && cacheable(kind);
        let wake = self
            .inner
            .state
            .lock()
            .unwrap()
            .enqueue(key, size, prio, waiter, probe);
        match wake {
            Wake::Workers => self.inner.cv.notify_all(),
            Wake::Probe => self.inner.probe_cv.notify_one(),
            Wake::Nobody => {}
        }
    }

    pub fn get(&self, path: PathBuf, kind: Kind, w: u32, h: u32) -> Reply {
        let (tx, rx) = std::sync::mpsc::channel();
        self.submit(path, kind, w, h, Box::new(move |r| _ = tx.send(r)));
        rx.recv()
            .unwrap_or_else(|_| Err(RenderError::Failed("pipeline stopped".into())))
    }

    pub fn prewarm(&self, paths: Vec<PathBuf>) -> usize {
        let Some(disk) = &self.inner.disk else {
            return 0;
        };
        self.cancel_idle();
        let mut todo = Vec::new();
        for path in paths {
            let worth = kind_of_ext(&ext_of(&path)).is_some_and(|k| k != FileKind::Video);
            let Some(meta) = std::fs::metadata(&path)
                .ok()
                .filter(|m| worth && m.is_file())
            else {
                continue;
            };
            let key = Key {
                path,
                mtime: modified_ms(&meta),
                kind: Kind::Thumb,
                w: THUMB_EDGE,
                h: THUMB_EDGE,
            };
            if !disk.contains(&disk_id(&key, meta.len())) {
                todo.push((key, meta.len()));
            }
        }
        let mut st = self.inner.state.lock().unwrap();
        let mut n = 0;
        for (key, size) in todo.into_iter().rev() {
            if st.inflight.contains_key(&key) {
                continue;
            }
            st.inflight.insert(
                key.clone(),
                Job {
                    waiters: Vec::new(),
                    size,
                    prio: Priority::Idle,
                    queued: true,
                },
            );
            st.lanes[lane(Priority::Idle)].push(key);
            n += 1;
        }
        drop(st);
        self.inner.cv.notify_all();
        n
    }

    fn cancel_idle(&self) {
        let mut st = self.inner.state.lock().unwrap();
        let idle = std::mem::take(&mut st.lanes[lane(Priority::Idle)]);
        for k in idle {
            st.inflight.remove(&k);
        }
    }

    pub fn idle_queued(&self) -> usize {
        self.inner.state.lock().unwrap().lanes[lane(Priority::Idle)].len()
    }

    pub fn cache_stats(&self) -> (usize, usize) {
        let c = self.inner.cache.lock().unwrap();
        (c.len(), c.bytes())
    }

    pub fn disk(&self) -> Option<&DiskCache> {
        self.inner.disk.as_ref()
    }
}

fn render_key(key: &Key) -> Result<(Encoded, bool), RenderError> {
    let r = std::panic::catch_unwind(AssertUnwindSafe(|| {
        let r = decode::render(&key.path, key.kind, key.w, key.h)?;
        let passthrough = matches!(r, Rendered::Passthrough);
        decode::finish(&key.path, r)
            .map(|e| (e, passthrough))
            .map_err(RenderError::Failed)
    }));
    r.unwrap_or_else(|_| Err(RenderError::Failed("decoder panicked".into())))
}

pub fn render_now(key: &Key) -> Result<Encoded, RenderError> {
    render_key(key).map(|(e, _)| e)
}

fn prober(inner: Arc<Inner>) {
    let disk = inner.disk.clone().expect("probe threads need a disk cache");
    loop {
        let (key, size) = {
            let mut st = inner.state.lock().unwrap();
            loop {
                if let Some(k) = st.probe.pop() {
                    let size = st.inflight.get(&k).map_or(0, |j| j.size);
                    break (k, size);
                }
                st = inner.probe_cv.wait(st).unwrap();
            }
        };
        let t0 = Instant::now();
        if let Some(e) = disk.get(&disk_id(&key, size)) {
            let e = Arc::new(e);
            inner
                .cache
                .lock()
                .unwrap()
                .insert(key.clone(), e.clone(), e.bytes.len() + 256);
            let job = inner.state.lock().unwrap().inflight.remove(&key);
            if let Some(job) = job {
                let ms = format!("{:.1}ms", t0.elapsed().as_secs_f64() * 1000.0);
                trace("disk", &key, job.prio, &ms);
                for w in job.waiters {
                    w(Ok(e.clone()));
                }
            }
            continue;
        }
        let mut st = inner.state.lock().unwrap();
        let Some(job) = st.inflight.get_mut(&key) else {
            continue;
        };
        job.queued = true;
        let l = lane(job.prio);
        st.lanes[l].push(key);
        drop(st);
        inner.cv.notify_all();
    }
}

fn pick(st: &mut State, workers: usize) -> Option<(Key, Priority)> {
    let take = |st: &mut State, p: Priority| {
        let k = st.lanes[lane(p)].pop()?;
        st.busy[lane(p)] += 1;
        if let Some(j) = st.inflight.get_mut(&k) {
            j.queued = false;
        }
        Some((k, p))
    };
    if let Some(r) = take(st, Priority::High) {
        return Some(r);
    }
    let background = st.busy[lane(Priority::Low)] + st.busy[lane(Priority::Idle)];
    if background + 1 >= workers {
        return None;
    }
    if let Some(r) = take(st, Priority::Low) {
        return Some(r);
    }
    if st.busy[lane(Priority::High)] == 0
        && st.busy[lane(Priority::Low)] == 0
        && st.busy[lane(Priority::Idle)] < IDLE_WORKERS
    {
        return take(st, Priority::Idle);
    }
    None
}

fn worker(inner: Arc<Inner>) {
    loop {
        let (key, ran_as) = {
            let mut st = inner.state.lock().unwrap();
            loop {
                if let Some(job) = pick(&mut st, inner.workers) {
                    break job;
                }
                st = inner.cv.wait(st).unwrap();
            }
        };
        let idle = ran_as == Priority::Idle;
        if idle {
            set_background_priority(true);
        }
        trace("start", &key, ran_as, "");
        let t0 = Instant::now();
        let out = render_key(&key);
        let took = t0.elapsed();
        if idle {
            set_background_priority(false);
        }
        let mut passthrough = false;
        let reply: Reply = out.map(|(e, pt)| {
            passthrough = pt;
            Arc::new(e)
        });
        let wanted =
            |st: &MutexGuard<State>| st.inflight.get(&key).is_some_and(|j| !j.waiters.is_empty());
        let asked_for = || !idle || wanted(&inner.state.lock().unwrap());
        if let Ok(e) = &reply
            && cacheable(key.kind)
            && asked_for()
        {
            inner
                .cache
                .lock()
                .unwrap()
                .insert(key.clone(), e.clone(), e.bytes.len() + 256);
        }
        let job = inner.state.lock().unwrap().finish(&key, ran_as);
        inner.cv.notify_all();
        let Some(job) = job else { continue };
        trace(
            "done",
            &key,
            job.prio,
            &format!("{:.0}ms", took.as_secs_f64() * 1000.0),
        );
        if let (Ok(e), Some(disk)) = (&reply, &inner.disk)
            && cacheable(key.kind)
            && !passthrough
            && took >= inner.disk_min_render
        {
            disk.put(disk_id(&key, job.size), e.clone());
        }
        for w in job.waiters {
            w(reply.clone());
        }
    }
}

#[cfg(windows)]
fn set_background_priority(on: bool) {
    use windows::Win32::System::Threading::{
        GetCurrentThread, SetThreadPriority, THREAD_MODE_BACKGROUND_BEGIN,
        THREAD_MODE_BACKGROUND_END,
    };
    let mode = if on {
        THREAD_MODE_BACKGROUND_BEGIN
    } else {
        THREAD_MODE_BACKGROUND_END
    };
    unsafe {
        let _ = SetThreadPriority(GetCurrentThread(), mode);
    }
}

#[cfg(not(windows))]
fn set_background_priority(_on: bool) {}

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

    fn slow_pngs(tag: &str, n: usize) -> (PathBuf, Vec<PathBuf>) {
        let dir = std::env::temp_dir().join(format!("lpview-{tag}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut img = image::RgbImage::new(1500, 1500);
        for (i, p) in img.pixels_mut().enumerate() {
            let v = (i as u32).wrapping_mul(2654435761);
            *p = image::Rgb([v as u8, (v >> 8) as u8, (v >> 16) as u8]);
        }
        let files = (0..n)
            .map(|i| {
                let p = dir.join(format!("t{i}.png"));
                img.save(&p).unwrap();
                p
            })
            .collect();
        (dir, files)
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
        let (dir, files) = slow_pngs("prio", 8);
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
        let thumbs: Vec<usize> = order
            .iter()
            .filter_map(|(n, _)| n.strip_prefix("thumb")?.parse().ok())
            .collect();
        assert!(thumbs[1..].windows(2).all(|w| w[0] > w[1]), "{order:?}");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn high_thumbs_jump_the_filmstrip_and_idle_waits() {
        let key = |n: &str| Key {
            path: PathBuf::from(n),
            mtime: 0,
            kind: Kind::Thumb,
            w: 320,
            h: 320,
        };
        let noop = || -> Waiter { Box::new(|_: Reply| {}) };
        let workers = 2;
        let mut st = State::default();
        for i in 0..6 {
            let wake = st.enqueue(key(&format!("film{i}")), 0, Priority::Low, noop(), false);
            assert_eq!(wake, Wake::Workers);
        }
        st.enqueue(key("warm"), 0, Priority::Idle, noop(), false);

        assert_eq!(pick(&mut st, workers), Some((key("film5"), Priority::Low)));
        assert_eq!(
            pick(&mut st, workers),
            None,
            "one worker stays free for the stage"
        );

        assert_eq!(
            st.enqueue(key("stage"), 0, Priority::High, noop(), false),
            Wake::Workers
        );
        assert_eq!(
            st.enqueue(key("film1"), 0, Priority::High, noop(), false),
            Wake::Workers
        );
        assert!(
            st.lanes[lane(Priority::Low)]
                .iter()
                .all(|k| *k != key("film1"))
        );
        assert_eq!(pick(&mut st, workers), Some((key("film1"), Priority::High)));
        assert_eq!(
            st.enqueue(key("film5"), 0, Priority::High, noop(), false),
            Wake::Nobody,
            "a running job only gains a waiter"
        );

        assert_eq!(
            st.finish(&key("film5"), Priority::Low)
                .map(|j| j.waiters.len()),
            Some(2)
        );
        assert_eq!(pick(&mut st, workers), Some((key("stage"), Priority::High)));
        assert_eq!(
            st.finish(&key("film1"), Priority::High)
                .map(|j| j.waiters.len()),
            Some(2)
        );
        assert!(st.finish(&key("stage"), Priority::High).is_some());

        for film in ["film4", "film3", "film2", "film0"] {
            assert_eq!(pick(&mut st, workers), Some((key(film), Priority::Low)));
            assert_eq!(
                pick(&mut st, workers),
                None,
                "{film}: idle waits for the filmstrip"
            );
            assert!(st.finish(&key(film), Priority::Low).is_some());
        }
        assert_eq!(pick(&mut st, workers), Some((key("warm"), Priority::Idle)));
        assert_eq!(pick(&mut st, workers), None);
    }

    #[test]
    fn lane_rules() {
        let key = |n: &str| Key {
            path: PathBuf::from(n),
            mtime: 0,
            kind: Kind::Thumb,
            w: 320,
            h: 320,
        };
        let mut st = State::default();
        st.lanes[lane(Priority::Low)] = vec![key("film0"), key("film1")];
        st.lanes[lane(Priority::Idle)] = vec![key("warm")];
        st.lanes[lane(Priority::High)] = vec![key("stage")];
        st.busy[lane(Priority::Low)] = 2;
        assert_eq!(pick(&mut st, 3).map(|(k, _)| k), Some(key("stage")));
        assert_eq!(pick(&mut st, 3), None);
        st.busy = [0; LANES];
        assert_eq!(pick(&mut st, 3), Some((key("film1"), Priority::Low)));
        assert_eq!(pick(&mut st, 3), Some((key("film0"), Priority::Low)));
        assert_eq!(pick(&mut st, 6), None);
        st.busy = [0; LANES];
        assert_eq!(pick(&mut st, 6), Some((key("warm"), Priority::Idle)));
    }

    #[test]
    fn disk_cache_round_trip_and_prewarm() {
        let (dir, files) = slow_pngs("disk", 4);
        let root = dir.join("cache");
        let disk = DiskCache::open(root.clone(), 1 << 30).unwrap();
        let pipe = Pipeline::with_disk_after(3, 1 << 20, Some(disk.clone()), Duration::ZERO);
        let first = pipe.get(files[0].clone(), Kind::Thumb, 320, 320).unwrap();
        disk.flush();
        assert_eq!(disk.stats().writes, 1, "a decoded thumb is written to disk");
        let pipe2 = Pipeline::with_disk_after(
            3,
            1 << 20,
            Some(DiskCache::open(root.clone(), 1 << 30).unwrap()),
            Duration::ZERO,
        );
        let again = pipe2.get(files[0].clone(), Kind::Thumb, 320, 320).unwrap();
        assert_eq!(again.bytes, first.bytes);
        assert_eq!(pipe2.disk().unwrap().stats().hits, 1);
        assert_eq!(pipe2.prewarm(files.clone()), 3);
        let deadline = Instant::now() + Duration::from_secs(30);
        while pipe2.idle_queued() > 0 || !pipe2.inner.state.lock().unwrap().inflight.is_empty() {
            assert!(Instant::now() < deadline, "pre-warm did not finish");
            std::thread::sleep(Duration::from_millis(20));
        }
        pipe2.disk().unwrap().flush();
        assert_eq!(pipe2.prewarm(files.clone()), 0, "everything is cached now");
        assert_eq!(
            pipe2.cache_stats().0,
            1,
            "pre-warmed thumbs skip the memory cache"
        );
        std::thread::sleep(Duration::from_millis(20));
        image::RgbImage::from_pixel(10, 10, image::Rgb([1, 2, 3]))
            .save(&files[0])
            .unwrap();
        let changed = pipe2.get(files[0].clone(), Kind::Thumb, 320, 320).unwrap();
        assert_eq!((changed.width, changed.height), (10, 10));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn renders_faster_than_the_threshold_stay_off_disk() {
        let (dir, files) = slow_pngs("fast", 1);
        let disk = DiskCache::open(dir.join("cache"), 1 << 30).unwrap();
        let pipe =
            Pipeline::with_disk_after(2, 1 << 20, Some(disk.clone()), Duration::from_secs(3600));
        pipe.get(files[0].clone(), Kind::Thumb, 320, 320).unwrap();
        disk.flush();
        assert_eq!(disk.stats().writes, 0);
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
