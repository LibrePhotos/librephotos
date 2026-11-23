pub mod disk;
pub mod geom;
pub mod source;

use std::collections::{BTreeSet, HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Condvar, Mutex, OnceLock};

use serde::Serialize;

use crate::cache::LruCache;
use crate::decode::RenderError;
use crate::listing::modified_ms;
use crate::orient;
use crate::pipeline::{Reply, Waiter};
use crate::pixels::{Encoded, Pixels};
use disk::DiskCache;
use geom::{Level, TILE};
use source::RowSource;

pub const MIN_TILED_PIXELS: u64 = 24_000_000;
const MEM_CACHE_BYTES: usize = 96 << 20;
const JOB_THREADS: usize = 4;
const ENCODE_THREADS: usize = 6;
const IO_THREADS: usize = 2;
const KEEP_IMAGES: usize = 3;
const TILE_QUALITY: u8 = 90;
const READ_CHUNK_ROWS: u32 = 256;

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TileInfo {
    pub width: u32,
    pub height: u32,
    pub tile_size: u32,
    pub levels: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
struct TileKey {
    id: u64,
    level: u32,
    x: u32,
    y: u32,
}

#[derive(Default)]
struct LevelState {
    done: Vec<bool>,
    failed: HashSet<u32>,
    demand: BTreeSet<u32>,
    waiters: HashMap<(u32, u32), Vec<Waiter>>,
    scheduled: bool,
    cursor: u32,
    source: Option<Box<dyn RowSource>>,
}

struct TileImage {
    id: u64,
    name: String,
    info: Option<TileInfo>,
    height: u32,
    orientation: u16,
    max_scale: u32,
    open: Option<source::Opener>,
    levels: Vec<(Level, Mutex<LevelState>)>,
}

struct Slot {
    path: PathBuf,
    mtime: i64,
    image: OnceLock<Result<Arc<TileImage>, RenderError>>,
}

type Job = (Arc<TileImage>, u32);
type BandTiles = Vec<((u32, u32), Arc<Encoded>)>;

#[derive(Default)]
struct Queues {
    demand: Vec<Job>,
    fill: VecDeque<Job>,
    io: Vec<(PathBuf, u32, u32, u32, Waiter)>,
    encode_now: VecDeque<EncodeJob>,
    encode_fill: VecDeque<EncodeJob>,
}

struct Inner {
    slots: Mutex<VecDeque<Arc<Slot>>>,
    mem: Mutex<LruCache<TileKey, Arc<Encoded>>>,
    disk: Option<DiskCache>,
    q: Mutex<Queues>,
    jobs_cv: Condvar,
    io_cv: Condvar,
    encode_cv: Condvar,
    active: Mutex<u64>,
    fill: AtomicBool,
    writer: Option<mpsc::Sender<DiskWrite>>,
}

#[derive(Clone)]
pub struct TileService {
    inner: Arc<Inner>,
}

enum DiskWrite {
    Tiles(String, u32, Vec<(u32, u32, Arc<Encoded>)>),
    LevelDone(String, u32),
}

type EncodeJob = (
    usize,
    Pixels,
    u16,
    mpsc::Sender<(usize, Result<Encoded, String>)>,
);

const TILE_FORMAT: u8 = 2;

fn image_id(path: &Path, mtime: i64, size: u64) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325 ^ TILE_FORMAT as u64;
    let s = path.to_string_lossy();
    for b in s
        .bytes()
        .chain(mtime.to_le_bytes())
        .chain(size.to_le_bytes())
    {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

fn trace() -> bool {
    static T: OnceLock<bool> = OnceLock::new();
    *T.get_or_init(|| std::env::var_os("LPVIEW_TILE_TRACE").is_some())
}

fn set_priority(urgent: bool) {
    #[cfg(windows)]
    unsafe {
        use windows::Win32::System::Threading::{
            GetCurrentThread, SetThreadPriority, THREAD_PRIORITY_BELOW_NORMAL,
            THREAD_PRIORITY_NORMAL,
        };
        let p = if urgent {
            THREAD_PRIORITY_NORMAL
        } else {
            THREAD_PRIORITY_BELOW_NORMAL
        };
        let _ = SetThreadPriority(GetCurrentThread(), p);
    }
    #[cfg(not(windows))]
    let _ = urgent;
}

fn lower_priority() {
    set_priority(false);
}

fn spawn(name: String, f: impl FnOnce() + Send + 'static) {
    std::thread::Builder::new()
        .name(name)
        .spawn(f)
        .expect("spawn tile thread");
}

impl TileService {
    pub fn new(disk_root: Option<PathBuf>, disk_cap: u64) -> TileService {
        let disk = disk_root.map(|r| DiskCache::new(r, disk_cap));
        let (wtx, wrx) = mpsc::channel::<DiskWrite>();
        let has_disk = disk.is_some();
        let inner = Arc::new(Inner {
            slots: Mutex::new(VecDeque::new()),
            mem: Mutex::new(LruCache::new(MEM_CACHE_BYTES)),
            disk,
            q: Mutex::new(Queues::default()),
            jobs_cv: Condvar::new(),
            io_cv: Condvar::new(),
            encode_cv: Condvar::new(),
            active: Mutex::new(0),
            fill: AtomicBool::new(true),
            writer: has_disk.then_some(wtx),
        });
        for i in 0..ENCODE_THREADS {
            let inner = inner.clone();
            spawn(format!("lpview-tile-enc-{i}"), move || {
                lower_priority();
                encode_worker(&inner)
            });
        }
        for i in 0..JOB_THREADS {
            let inner = inner.clone();
            spawn(format!("lpview-tile-job-{i}"), move || {
                lower_priority();
                job_worker(&inner)
            });
        }
        for i in 0..IO_THREADS {
            let inner = inner.clone();
            spawn(format!("lpview-tile-io-{i}"), move || io_worker(&inner));
        }
        if inner.disk.is_some() {
            let inner = inner.clone();
            spawn("lpview-tile-disk".into(), move || {
                lower_priority();
                disk_worker(&inner, wrx)
            });
        }
        TileService { inner }
    }

    pub fn info(&self, path: &Path) -> Result<Option<TileInfo>, String> {
        if std::env::var_os("LPVIEW_TILES").is_some_and(|v| v == "off") {
            return Ok(None);
        }
        let img = self.inner.image(path).map_err(|e| e.to_string())?;
        if img.info.is_some() {
            self.inner.activate(&img);
        }
        Ok(img.info)
    }

    pub fn release(&self, path: &Path) {
        if let Some(img) = self.inner.opened(path) {
            let mut a = self.inner.active.lock().unwrap();
            if *a == img.id {
                *a = 0;
            }
        }
    }

    pub fn request(&self, path: PathBuf, level: u32, x: u32, y: u32, waiter: Waiter) {
        if let Some(img) = self.inner.opened(&path)
            && let Some(hit) = self.inner.mem.lock().unwrap().get(&TileKey {
                id: img.id,
                level,
                x,
                y,
            })
        {
            return waiter(Ok(hit));
        }
        self.inner
            .q
            .lock()
            .unwrap()
            .io
            .push((path, level, x, y, waiter));
        self.inner.io_cv.notify_one();
    }

    pub fn get(&self, path: &Path, level: u32, x: u32, y: u32) -> Reply {
        let (tx, rx) = mpsc::channel();
        self.request(
            path.to_path_buf(),
            level,
            x,
            y,
            Box::new(move |r| _ = tx.send(r)),
        );
        rx.recv()
            .unwrap_or_else(|_| Err(RenderError::Failed("tile service stopped".into())))
    }

    pub fn set_fill(&self, on: bool) {
        self.inner.fill.store(on, Ordering::Relaxed);
    }

    pub fn stats(&self) -> (usize, usize, u64) {
        let m = self.inner.mem.lock().unwrap();
        let d = self.inner.disk.as_ref().map_or(0, |d| d.total_bytes());
        (m.len(), m.bytes(), d)
    }
}

impl Inner {
    fn stat(path: &Path) -> Result<(i64, u64), RenderError> {
        match std::fs::metadata(path) {
            Ok(m) if m.is_file() => Ok((modified_ms(&m), m.len())),
            _ => Err(RenderError::NotFound(format!(
                "{} not found",
                path.display()
            ))),
        }
    }

    fn opened(&self, path: &Path) -> Option<Arc<TileImage>> {
        let (mtime, _) = Self::stat(path).ok()?;
        let slots = self.slots.lock().unwrap();
        let slot = slots.iter().find(|s| s.mtime == mtime && s.path == path)?;
        slot.image.get()?.as_ref().ok().cloned()
    }

    fn image(&self, path: &Path) -> Result<Arc<TileImage>, RenderError> {
        let (mtime, size) = Self::stat(path)?;
        let slot = {
            let mut slots = self.slots.lock().unwrap();
            match slots
                .iter()
                .position(|s| s.mtime == mtime && s.path == path)
            {
                Some(i) => {
                    let s = slots.remove(i).unwrap();
                    slots.push_front(s.clone());
                    s
                }
                None => {
                    let s = Arc::new(Slot {
                        path: path.to_path_buf(),
                        mtime,
                        image: OnceLock::new(),
                    });
                    slots.push_front(s.clone());
                    slots.truncate(KEEP_IMAGES);
                    s
                }
            }
        };
        slot.image
            .get_or_init(|| self.open_image(path, mtime, size).map(Arc::new))
            .clone()
    }

    fn open_image(&self, path: &Path, mtime: i64, size: u64) -> Result<TileImage, RenderError> {
        let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        let id = image_id(&canonical, mtime, size);
        let untiled = || TileImage {
            id,
            name: format!("{id:016x}"),
            info: None,
            height: 0,
            orientation: 1,
            max_scale: 0,
            open: None,
            levels: Vec::new(),
        };
        let big = |w: u32, h: u32| w as u64 * h as u64 > MIN_TILED_PIXELS;
        if let Some((w, h)) = source::probe_dims(path)
            && !big(w, h)
        {
            return Ok(untiled());
        }
        let o = source::open(path).map_err(RenderError::Failed)?;
        let (ow, oh) = orient::oriented_dims(o.width, o.height, o.orientation);
        if o.has_alpha || !big(ow, oh) {
            return Ok(untiled());
        }
        let info = TileInfo {
            width: ow,
            height: oh,
            tile_size: TILE,
            levels: geom::level_count(ow, oh),
        };
        let name = format!("{id:016x}");
        let levels = (0..info.levels)
            .map(|l| {
                let lv = Level::new(o.width, o.height, o.orientation, l);
                let all = self.disk.as_ref().is_some_and(|d| d.level_done(&name, l));
                let st = LevelState {
                    done: vec![all; lv.band_count() as usize],
                    ..Default::default()
                };
                (lv, Mutex::new(st))
            })
            .collect();
        Ok(TileImage {
            id,
            name,
            info: Some(info),
            height: o.height,
            orientation: o.orientation,
            max_scale: o.max_scale,
            open: Some(o.open),
            levels,
        })
    }

    fn activate(&self, img: &TileImage) {
        let mut a = self.active.lock().unwrap();
        if *a != img.id {
            *a = img.id;
            drop(a);
            if let Some(d) = &self.disk {
                d.touch(&img.name);
            }
        }
    }

    fn may_fill(&self, img: &TileImage) -> bool {
        self.fill.load(Ordering::Relaxed) && *self.active.lock().unwrap() == img.id
    }

    fn serve(&self, path: PathBuf, level: u32, x: u32, y: u32, waiter: Waiter) {
        let img = match self.image(&path) {
            Ok(i) => i,
            Err(e) => return waiter(Err(e)),
        };
        if img.info.is_none() {
            return waiter(Err(RenderError::Unsupported(format!(
                "{} is not tiled",
                path.display()
            ))));
        }
        let Some((lv, state)) = img.levels.get(level as usize) else {
            return waiter(Err(RenderError::NotFound(format!("no level {level}"))));
        };
        if !lv.contains(x, y) {
            return waiter(Err(RenderError::NotFound(format!(
                "no tile {x},{y} at level {level}"
            ))));
        }
        self.activate(&img);
        let key = TileKey {
            id: img.id,
            level,
            x,
            y,
        };
        if let Some(hit) = self.mem.lock().unwrap().get(&key) {
            return waiter(Ok(hit));
        }
        if let Some(bytes) = self
            .disk
            .as_ref()
            .and_then(|d| d.read(&img.name, level, x, y))
        {
            let r = lv.tile_rect(x, y);
            let e = Arc::new(Encoded {
                bytes,
                mime: "image/jpeg",
                width: r.w,
                height: r.h,
            });
            self.mem
                .lock()
                .unwrap()
                .insert(key, e.clone(), e.bytes.len() + 64);
            return waiter(Ok(e));
        }
        let band = lv.band_of(x, y);
        let mut st = state.lock().unwrap();
        if st.done[band as usize] {
            if let Some(hit) = self.mem.lock().unwrap().get(&key) {
                return waiter(Ok(hit));
            }
            st.done[band as usize] = false;
        }
        st.failed.remove(&band);
        st.waiters.entry((x, y)).or_default().push(waiter);
        st.demand.insert(band);
        if !st.scheduled {
            st.scheduled = true;
            drop(st);
            self.q.lock().unwrap().demand.push((img.clone(), level));
            self.jobs_cv.notify_one();
        }
    }

    fn to_disk(&self, w: DiskWrite) {
        if let Some(tx) = &self.writer {
            let _ = tx.send(w);
        }
    }

    fn encode_all(
        &self,
        tiles: Vec<Pixels>,
        orientation: u16,
        urgent: bool,
    ) -> Vec<Result<Encoded, String>> {
        let n = tiles.len();
        let (tx, rx) = mpsc::channel();
        {
            let mut q = self.q.lock().unwrap();
            let lane = if urgent {
                &mut q.encode_now
            } else {
                &mut q.encode_fill
            };
            lane.extend(
                tiles
                    .into_iter()
                    .enumerate()
                    .map(|(i, p)| (i, p, orientation, tx.clone())),
            );
        }
        drop(tx);
        self.encode_cv.notify_all();
        let mut out: Vec<Option<Result<Encoded, String>>> = (0..n).map(|_| None).collect();
        for (i, r) in rx.iter() {
            out[i] = Some(r);
        }
        out.into_iter()
            .map(|r| r.unwrap_or_else(|| Err("encoder stopped".into())))
            .collect()
    }
}

fn disk_worker(inner: &Inner, rx: mpsc::Receiver<DiskWrite>) {
    let Some(d) = &inner.disk else { return };
    d.scan();
    d.evict(&[]);
    for w in rx {
        match w {
            DiskWrite::Tiles(name, level, tiles) => {
                for (x, y, e) in tiles {
                    d.write(&name, level, x, y, &e.bytes);
                }
                let keep: Vec<String> = inner
                    .slots
                    .lock()
                    .unwrap()
                    .iter()
                    .filter_map(|s| s.image.get()?.as_ref().ok().map(|i| i.name.clone()))
                    .collect();
                d.evict(&keep);
            }
            DiskWrite::LevelDone(name, level) => d.mark_level_done(&name, level),
        }
    }
}

pub fn encode_tile(px: &Pixels) -> Result<Encoded, String> {
    #[cfg(windows)]
    if let Ok(bytes) = crate::decode::wic::encode_jpeg_with(px, TILE_QUALITY as f32 / 100.0, true) {
        return Ok(Encoded {
            bytes,
            mime: "image/jpeg",
            width: px.width,
            height: px.height,
        });
    }
    px.encode_jpeg_rust(TILE_QUALITY)
}

fn encode_worker(inner: &Inner) {
    loop {
        let ((idx, px, orientation, reply), urgent) = {
            let mut q = inner.q.lock().unwrap();
            loop {
                if let Some(j) = q.encode_now.pop_front() {
                    break (j, true);
                }
                if let Some(j) = q.encode_fill.pop_front() {
                    break (j, false);
                }
                q = inner.encode_cv.wait(q).unwrap();
            }
        };
        set_priority(urgent);
        let px = orient::apply(px, orientation);
        let _ = reply.send((idx, encode_tile(&px)));
    }
}

fn io_worker(inner: &Inner) {
    loop {
        let (path, level, x, y, waiter) = {
            let mut q = inner.q.lock().unwrap();
            loop {
                if let Some(r) = q.io.pop() {
                    break r;
                }
                q = inner.io_cv.wait(q).unwrap();
            }
        };
        inner.serve(path, level, x, y, waiter);
    }
}

fn job_worker(inner: &Inner) {
    loop {
        let job = {
            let mut q = inner.q.lock().unwrap();
            loop {
                if let Some(j) = q.demand.pop() {
                    break Some(j);
                }
                if let Some(j) = q.fill.pop_front() {
                    break Some(j);
                }
                q = inner.jobs_cv.wait(q).unwrap();
            }
        };
        if let Some((img, level)) = job {
            run_level(inner, &img, level);
        }
    }
}

fn next_band(lv: &Level, cursor: u32, bands: impl Iterator<Item = u32>) -> Option<u32> {
    let mut best: Option<(bool, u32, u32)> = None;
    for b in bands {
        let start = lv.band_rows(b).0;
        let k = (start < cursor, start, b);
        if best.is_none_or(|bk| k < bk) {
            best = Some(k);
        }
    }
    best.map(|(_, _, b)| b)
}

fn run_level(inner: &Inner, img: &Arc<TileImage>, level: u32) {
    let (lv, state) = &img.levels[level as usize];
    loop {
        let (band, urgent, mut src) = {
            let mut st = state.lock().unwrap();
            let demanded = next_band(lv, st.cursor, st.demand.iter().copied());
            let band = match demanded {
                Some(b) => b,
                None => {
                    let todo = (0..lv.band_count())
                        .filter(|&b| !st.done[b as usize] && !st.failed.contains(&b));
                    let fill = next_band(lv, st.cursor, todo);
                    let Some(b) = fill.filter(|_| inner.may_fill(img)) else {
                        if fill.is_none() && st.failed.is_empty() {
                            inner.to_disk(DiskWrite::LevelDone(img.name.clone(), level));
                        }
                        st.scheduled = false;
                        return;
                    };
                    if !inner.q.lock().unwrap().demand.is_empty() {
                        drop(st);
                        inner.q.lock().unwrap().fill.push_back((img.clone(), level));
                        inner.jobs_cv.notify_one();
                        return;
                    }
                    b
                }
            };
            (band, demanded.is_some(), st.source.take())
        };
        set_priority(urgent);
        let on_disk = inner.disk.as_ref().is_some_and(|d| {
            lv.band_tiles(band)
                .iter()
                .all(|&(x, y, _)| d.contains(&img.name, level, x, y))
        });
        let result = if on_disk {
            Ok(Vec::new())
        } else {
            let opened = match src.take() {
                Some(s) => Ok(s),
                None => (img.open.as_ref().expect("tiled image has a source"))(),
            };
            opened.and_then(|mut s| {
                let r = make_band(inner, img, level, band, urgent, s.as_mut());
                src = Some(s);
                r
            })
        };
        let waiters = {
            let mut st = state.lock().unwrap();
            st.source = src;
            st.demand.remove(&band);
            match &result {
                Ok(_) => {
                    st.done[band as usize] = true;
                    st.cursor = lv.band_rows(band).1;
                }
                Err(_) => {
                    st.failed.insert(band);
                }
            }
            let mut out = Vec::new();
            for (x, y, _) in lv.band_tiles(band) {
                if let Some(ws) = st.waiters.remove(&(x, y)) {
                    out.push(((x, y), ws));
                }
            }
            out
        };
        let tiles: HashMap<(u32, u32), Arc<Encoded>> = match &result {
            Ok(v) => v.iter().cloned().collect(),
            Err(_) => HashMap::new(),
        };
        for ((x, y), ws) in waiters {
            let reply: Reply = match (&result, tiles.get(&(x, y))) {
                (Err(e), _) => Err(RenderError::Failed(e.clone())),
                (Ok(_), Some(t)) => Ok(t.clone()),
                (Ok(_), None) => {
                    for w in ws {
                        inner.serve_after_band(img, level, x, y, w);
                    }
                    continue;
                }
            };
            for w in ws {
                w(reply.clone());
            }
        }
    }
}

impl Inner {
    fn serve_after_band(&self, img: &TileImage, level: u32, x: u32, y: u32, w: Waiter) {
        let (lv, _) = &img.levels[level as usize];
        match self
            .disk
            .as_ref()
            .and_then(|d| d.read(&img.name, level, x, y))
        {
            Some(bytes) => {
                let r = lv.tile_rect(x, y);
                w(Ok(Arc::new(Encoded {
                    bytes,
                    mime: "image/jpeg",
                    width: r.w,
                    height: r.h,
                })))
            }
            None => w(Err(RenderError::Failed(
                "tile vanished from the cache".into(),
            ))),
        }
    }
}

fn make_band(
    inner: &Inner,
    img: &TileImage,
    level: u32,
    band: u32,
    urgent: bool,
    src: &mut dyn RowSource,
) -> Result<BandTiles, String> {
    let (lv, _) = &img.levels[level as usize];
    let t0 = std::time::Instant::now();
    let px = band_pixels(img, lv, level, band, src)?;
    let t1 = t0.elapsed();
    let cuts = lv.band_tiles(band);
    let o = img.orientation;
    let tiles: Vec<Pixels> = cuts
        .iter()
        .map(|&(_, _, r)| geom::crop(&px, geom::to_stored(o, px.width, px.height, r)))
        .collect();
    drop(px);
    let t2 = t0.elapsed();
    let encoded = inner.encode_all(tiles, o, urgent);
    if trace() {
        eprintln!(
            "[tiles] {} L{level} band {band}: decode {:.0} ms, cut {:.0} ms, orient+encode {} tiles {:.0} ms{}",
            img.name,
            t1.as_secs_f64() * 1e3,
            (t2 - t1).as_secs_f64() * 1e3,
            cuts.len(),
            (t0.elapsed() - t2).as_secs_f64() * 1e3,
            if urgent { "" } else { " (fill)" }
        );
    }
    let mut out = Vec::with_capacity(cuts.len());
    let mut mem = Vec::with_capacity(cuts.len());
    for ((x, y, _), e) in cuts.into_iter().zip(encoded) {
        let e = Arc::new(e?);
        mem.push((x, y, e.clone()));
        out.push(((x, y), e));
    }
    {
        let mut m = inner.mem.lock().unwrap();
        for (x, y, e) in &mem {
            let len = e.bytes.len() + 64;
            m.insert(
                TileKey {
                    id: img.id,
                    level,
                    x: *x,
                    y: *y,
                },
                e.clone(),
                len,
            );
        }
    }
    inner.to_disk(DiskWrite::Tiles(img.name.clone(), level, mem));
    Ok(out)
}

fn band_pixels(
    img: &TileImage,
    lv: &Level,
    level: u32,
    band: u32,
    src: &mut dyn RowSource,
) -> Result<Pixels, String> {
    let (r0, r1) = lv.band_rows(band);
    let s = level.min(img.max_scale);
    let f = 1u32 << (level - s);
    let src_h = img.height.div_ceil(1 << s);
    let (y0, y1) = (r0 * f, (r1 * f).min(src_h));
    let chunk = if f == 1 {
        y1 - y0
    } else {
        READ_CHUNK_ROWS.max(f)
    };
    let mut parts = Vec::new();
    let mut y = y0;
    while y < y1 {
        let end = (y + chunk).min(y1);
        let rows = src.rows(s, y, end)?;
        parts.push(if f == 1 {
            rows
        } else {
            geom::box_reduce(&rows, f)
        });
        y = end;
    }
    let px = geom::stack(parts).ok_or("empty band")?;
    if (px.width, px.height) != (lv.sw, r1 - r0) {
        return Err(format!(
            "band {band} of level {level} came out {}x{}, expected {}x{}",
            px.width,
            px.height,
            lv.sw,
            r1 - r0
        ));
    }
    Ok(px)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TileRequest {
    pub path: PathBuf,
    pub level: u32,
    pub x: u32,
    pub y: u32,
}

pub fn is_tile_url(uri_path: &str) -> bool {
    uri_path.trim_matches('/') == "tile"
}

pub fn parse(query: Option<&str>) -> Result<TileRequest, String> {
    let q = query.unwrap_or("");
    let path = crate::request::query_param(q, "path")
        .filter(|p| !p.is_empty())
        .ok_or("missing path")?;
    let num = |k: &str| {
        crate::request::query_param(q, k)
            .and_then(|v| v.parse::<u32>().ok())
            .ok_or_else(|| format!("missing or bad '{k}'"))
    };
    Ok(TileRequest {
        path: PathBuf::from(path),
        level: num("level")?,
        x: num("x")?,
        y: num("y")?,
    })
}

pub fn handle(
    svc: &TileService,
    query: Option<&str>,
    respond: impl FnOnce(tauri::http::Response<Vec<u8>>) + Send + 'static,
) {
    match parse(query) {
        Ok(r) => svc.request(
            r.path,
            r.level,
            r.x,
            r.y,
            Box::new(move |reply| respond(crate::protocol::reply_response(reply))),
        ),
        Err(e) => respond(crate::protocol::text(
            tauri::http::StatusCode::BAD_REQUEST,
            e,
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pixels::PixFmt;

    #[test]
    fn parses_tile_urls() {
        assert!(is_tile_url("/tile") && !is_tile_url("/full"));
        let r = parse(Some("path=C%3A%5Cx%20y.jpg&v=1&level=2&x=3&y=4")).unwrap();
        assert_eq!(r.path, PathBuf::from(r"C:\x y.jpg"));
        assert_eq!((r.level, r.x, r.y), (2, 3, 4));
        assert!(parse(Some("path=a.jpg&level=1&x=2")).is_err());
        assert!(parse(Some("level=1&x=2&y=3")).is_err());
        assert!(parse(Some("path=a.jpg&level=-1&x=2&y=3")).is_err());
    }

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("lpview-tiles-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn big_jpeg(dir: &Path, o: u16) -> PathBuf {
        let (w, h) = (6000u32, 4500u32);
        let mut data = Vec::with_capacity((w * h * 3) as usize);
        for y in 0..h {
            for x in 0..w {
                data.extend_from_slice(&[(x / 24) as u8, (y / 18) as u8, 128]);
            }
        }
        let px = Pixels {
            width: w,
            height: h,
            format: PixFmt::Rgb8,
            data,
        };
        let jpeg = px.encode_jpeg_rust(90).unwrap().bytes;
        let jpeg = crate::jpegmeta::with_orientation(&jpeg, o).unwrap();
        let p = dir.join(format!("big_{o}.jpg"));
        std::fs::write(&p, jpeg).unwrap();
        p
    }

    fn decode(e: &Encoded) -> image::RgbImage {
        image::load_from_memory(&e.bytes).unwrap().into_rgb8()
    }

    #[test]
    fn disk_id_ignores_path_spelling() {
        let dir = temp("spelling");
        let p = dir.join("a.png");
        image::RgbImage::from_pixel(8, 8, image::Rgb([1, 2, 3]))
            .save(&p)
            .unwrap();
        let svc = TileService::new(None, 0);
        let other = PathBuf::from(p.to_string_lossy().replace('\\', "/").to_uppercase());
        let a = svc.inner.image(&p).unwrap();
        let b = svc.inner.image(&other).unwrap();
        assert_eq!(a.name, b.name);
    }

    #[test]
    fn small_images_are_not_tiled() {
        let dir = temp("small");
        let p = dir.join("s.png");
        image::RgbImage::from_pixel(640, 480, image::Rgb([1, 2, 3]))
            .save(&p)
            .unwrap();
        let svc = TileService::new(None, 0);
        assert_eq!(svc.info(&p).unwrap(), None);
        assert!(matches!(
            svc.get(&p, 0, 0, 0),
            Err(RenderError::Unsupported(_))
        ));
        assert!(matches!(
            svc.get(&dir.join("missing.jpg"), 0, 0, 0),
            Err(RenderError::NotFound(_))
        ));
    }

    #[test]
    fn serves_oriented_tiles_from_memory_and_disk() {
        let dir = temp("big");
        let p = big_jpeg(&dir, 6);
        let root = dir.join("cache");
        let svc = TileService::new(Some(root.clone()), 1 << 30);
        let info = svc.info(&p).unwrap().unwrap();
        assert_eq!(
            info,
            TileInfo {
                width: 4500,
                height: 6000,
                tile_size: 512,
                levels: 5
            }
        );
        let t0 = svc.get(&p, 0, 8, 11).unwrap();
        let t = t0.clone();
        assert_eq!((t.width, t.height), (405, 369));
        let img = decode(&t);
        assert_eq!(img.dimensions(), (405, 369));
        let (dx, dy) = (8 * 512 - 1 + 200, 11 * 512 - 1 + 100);
        let (sx, sy) = (dy, 4500 - 1 - dx);
        let px = img.get_pixel(200, 100);
        assert!((px[0] as i32 - (sx / 24)).abs() <= 3, "{px:?}");
        assert!((px[1] as i32 - (sy / 18)).abs() <= 3, "{px:?}");
        assert!(svc.stats().0 >= 12);
        let t = svc.get(&p, 4, 0, 0).unwrap();
        assert_eq!((t.width, t.height), (282, 375));
        assert!(matches!(
            svc.get(&p, 0, 9, 0),
            Err(RenderError::NotFound(_))
        ));
        assert!(matches!(
            svc.get(&p, 9, 0, 0),
            Err(RenderError::NotFound(_))
        ));
        let svc2 = TileService::new(Some(root), 1 << 30);
        let t2 = svc2.get(&p, 0, 8, 11).unwrap();
        assert_eq!(t2.bytes, t0.bytes);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
