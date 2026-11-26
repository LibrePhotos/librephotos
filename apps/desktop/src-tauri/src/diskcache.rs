use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError, SyncSender, TrySendError, sync_channel};
use std::time::{Duration, Instant, SystemTime};

use crate::pixels::Encoded;

const MAGIC: &[u8; 4] = b"LPC1";
const LAYOUT: &str = "v1";
pub const DEFAULT_CAP: u64 = 1 << 30;
const SWEEP_TARGET: f64 = 0.9;
const TOUCH_AFTER: Duration = Duration::from_secs(3600);
const TMP_MAX_AGE: Duration = Duration::from_secs(3600);
const FIRST_SWEEP_AFTER: Duration = Duration::from_secs(20);
const WRITE_QUEUE: usize = 512;

pub fn default_dir() -> Option<PathBuf> {
    if std::env::var("LPVIEW_DISK_CACHE").is_ok_and(|v| v == "0") {
        return None;
    }
    if let Some(d) = std::env::var_os("LPVIEW_CACHE_DIR").filter(|d| !d.is_empty()) {
        return Some(PathBuf::from(d));
    }
    if let Some(d) = crate::appdirs::override_dir() {
        return Some(d.join("cache"));
    }
    let env_dir = |k: &str| {
        std::env::var_os(k)
            .filter(|d| !d.is_empty())
            .map(PathBuf::from)
    };
    if cfg!(windows) {
        env_dir("LOCALAPPDATA").map(|d| d.join(crate::appdirs::DIR_NAME).join("cache"))
    } else if cfg!(target_os = "macos") {
        env_dir("HOME").map(|d| crate::appdirs::macos_caches(&d).join("thumbs"))
    } else {
        env_dir("XDG_CACHE_HOME")
            .or_else(|| env_dir("HOME").map(|h| h.join(".cache")))
            .map(|d| d.join(crate::appdirs::DIR_NAME))
    }
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct DiskStats {
    pub hits: u64,
    pub misses: u64,
    pub writes: u64,
    pub evictions: u64,
}

struct Inner {
    root: PathBuf,
    cap: u64,
    estimate: AtomicU64,
    hits: AtomicU64,
    misses: AtomicU64,
    writes: AtomicU64,
    evictions: AtomicU64,
    tmp_seq: AtomicU64,
}

enum Msg {
    Write(String, Arc<Encoded>),
    Flush(std::sync::mpsc::Sender<()>),
}

#[derive(Clone)]
pub struct DiskCache {
    inner: Arc<Inner>,
    tx: SyncSender<Msg>,
}

fn fnv1a(s: &str) -> u64 {
    s.bytes().fold(0xcbf2_9ce4_8422_2325, |h, b| {
        (h ^ b as u64).wrapping_mul(0x0000_0100_0000_01b3)
    })
}

fn static_mime(m: &str) -> Option<&'static str> {
    [
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
        "image/bmp",
        "image/avif",
    ]
    .into_iter()
    .find(|s| *s == m)
}

fn serialize(id: &str, e: &Encoded) -> Vec<u8> {
    let mut out = Vec::with_capacity(e.bytes.len() + id.len() + 64);
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&(id.len() as u32).to_le_bytes());
    out.extend_from_slice(id.as_bytes());
    out.push(e.mime.len() as u8);
    out.extend_from_slice(e.mime.as_bytes());
    out.extend_from_slice(&e.width.to_le_bytes());
    out.extend_from_slice(&e.height.to_le_bytes());
    out.extend_from_slice(&(e.bytes.len() as u64).to_le_bytes());
    out.extend_from_slice(&e.bytes);
    out
}

#[allow(clippy::result_unit_err)]
pub fn deserialize(id: &str, mut b: &[u8]) -> Result<Option<Encoded>, ()> {
    fn take<'a>(b: &mut &'a [u8], n: usize) -> Result<&'a [u8], ()> {
        if b.len() < n {
            return Err(());
        }
        let (head, rest) = b.split_at(n);
        *b = rest;
        Ok(head)
    }
    let u32_of = |s: &[u8]| u32::from_le_bytes(s.try_into().unwrap());
    if take(&mut b, 4)? != MAGIC {
        return Err(());
    }
    let id_len = u32_of(take(&mut b, 4)?) as usize;
    if take(&mut b, id_len)? != id.as_bytes() {
        return Ok(None);
    }
    let mime_len = take(&mut b, 1)?[0] as usize;
    let mime = std::str::from_utf8(take(&mut b, mime_len)?).map_err(|_| ())?;
    let mime = static_mime(mime).ok_or(())?;
    let width = u32_of(take(&mut b, 4)?);
    let height = u32_of(take(&mut b, 4)?);
    let len = u64::from_le_bytes(take(&mut b, 8)?.try_into().unwrap()) as usize;
    if b.len() != len {
        return Err(());
    }
    Ok(Some(Encoded {
        bytes: b.to_vec(),
        mime,
        width,
        height,
    }))
}

impl DiskCache {
    pub fn open(root: PathBuf, cap: u64) -> std::io::Result<DiskCache> {
        let root = root.join(LAYOUT);
        fs::create_dir_all(&root)?;
        let inner = Arc::new(Inner {
            root,
            cap,
            estimate: AtomicU64::new(0),
            hits: AtomicU64::new(0),
            misses: AtomicU64::new(0),
            writes: AtomicU64::new(0),
            evictions: AtomicU64::new(0),
            tmp_seq: AtomicU64::new(0),
        });
        let (tx, rx) = sync_channel(WRITE_QUEUE);
        let w = inner.clone();
        std::thread::Builder::new()
            .name("lpview-disk-writer".into())
            .spawn(move || writer(w, rx))?;
        Ok(DiskCache { inner, tx })
    }

    fn file_of(&self, id: &str) -> PathBuf {
        let h = fnv1a(id);
        self.inner
            .root
            .join(format!("{:02x}", h >> 56))
            .join(format!("{h:016x}.lpc"))
    }

    pub fn get(&self, id: &str) -> Option<Encoded> {
        let path = self.file_of(id);
        let found = read_entry(&path, id);
        let counter = if found.is_some() {
            &self.inner.hits
        } else {
            &self.inner.misses
        };
        counter.fetch_add(1, Ordering::Relaxed);
        found
    }

    pub fn contains(&self, id: &str) -> bool {
        self.file_of(id).is_file()
    }

    pub fn put(&self, id: String, e: Arc<Encoded>) {
        if static_mime(e.mime).is_none() {
            return;
        }
        match self.tx.try_send(Msg::Write(id, e)) {
            Ok(()) | Err(TrySendError::Full(_)) | Err(TrySendError::Disconnected(_)) => {}
        }
    }

    pub fn stats(&self) -> DiskStats {
        let l = |a: &AtomicU64| a.load(Ordering::Relaxed);
        DiskStats {
            hits: l(&self.inner.hits),
            misses: l(&self.inner.misses),
            writes: l(&self.inner.writes),
            evictions: l(&self.inner.evictions),
        }
    }

    pub fn flush(&self) {
        let (tx, rx) = std::sync::mpsc::channel();
        if self.tx.send(Msg::Flush(tx)).is_ok() {
            let _ = rx.recv_timeout(Duration::from_secs(10));
        }
    }

    pub fn sweep(&self) {
        self.inner.sweep();
    }

    pub fn clear(&self) -> u64 {
        let mut freed = 0;
        for (_, len, path) in self.inner.entries() {
            if fs::remove_file(&path).is_ok() {
                freed += len;
            }
        }
        self.inner.estimate.store(0, Ordering::Relaxed);
        freed
    }

    pub fn disk_bytes(&self) -> u64 {
        self.inner.entries().iter().map(|e| e.1).sum()
    }
}

fn read_entry(path: &Path, id: &str) -> Option<Encoded> {
    let mut f = fs::File::open(path).ok()?;
    let meta = f.metadata().ok()?;
    let mut buf = Vec::with_capacity(meta.len() as usize);
    f.read_to_end(&mut buf).ok()?;
    drop(f);
    match deserialize(id, &buf) {
        Ok(Some(e)) => {
            let stale = meta
                .modified()
                .ok()
                .and_then(|m| m.elapsed().ok())
                .is_none_or(|age| age > TOUCH_AFTER);
            if stale {
                let _ = fs::File::options()
                    .write(true)
                    .open(path)
                    .and_then(|f| f.set_modified(SystemTime::now()));
            }
            Some(e)
        }
        Ok(None) => None,
        Err(()) => {
            let _ = fs::remove_file(path);
            None
        }
    }
}

fn writer(inner: Arc<Inner>, rx: Receiver<Msg>) {
    let started = Instant::now();
    let mut swept = false;
    loop {
        match rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Msg::Flush(ack)) => {
                let _ = ack.send(());
            }
            Ok(Msg::Write(id, e)) => {
                if let Ok(n) = inner.write(&id, &e) {
                    inner.estimate.fetch_add(n, Ordering::Relaxed);
                    inner.writes.fetch_add(1, Ordering::Relaxed);
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }
        let due = !swept && started.elapsed() >= FIRST_SWEEP_AFTER;
        if due || inner.estimate.load(Ordering::Relaxed) > inner.cap {
            inner.sweep();
            swept = true;
        }
    }
}

const RENAME_ATTEMPTS: u32 = 5;
const RENAME_BACKOFF: Duration = Duration::from_millis(5);

fn rename_over_readers(from: &Path, to: &Path) -> std::io::Result<()> {
    let mut attempt = 1;
    loop {
        match fs::rename(from, to) {
            Err(e)
                if e.kind() == std::io::ErrorKind::PermissionDenied
                    && attempt < RENAME_ATTEMPTS =>
            {
                std::thread::sleep(RENAME_BACKOFF * attempt);
                attempt += 1;
            }
            other => return other,
        }
    }
}

impl Inner {
    fn write(&self, id: &str, e: &Encoded) -> std::io::Result<u64> {
        let h = fnv1a(id);
        let dir = self.root.join(format!("{:02x}", h >> 56));
        fs::create_dir_all(&dir)?;
        let dest = dir.join(format!("{h:016x}.lpc"));
        let seq = self.tmp_seq.fetch_add(1, Ordering::Relaxed);
        let tmp = dir.join(format!("{h:016x}.{}-{seq}.tmp", std::process::id()));
        let data = serialize(id, e);
        let res = fs::File::create(&tmp)
            .and_then(|mut f| f.write_all(&data))
            .and_then(|_| rename_over_readers(&tmp, &dest));
        if res.is_err() {
            let _ = fs::remove_file(&tmp);
        }
        res.map(|_| data.len() as u64)
    }

    fn entries(&self) -> Vec<(SystemTime, u64, PathBuf)> {
        let mut out = Vec::new();
        let Ok(dirs) = fs::read_dir(&self.root) else {
            return out;
        };
        for d in dirs.flatten() {
            let Ok(files) = fs::read_dir(d.path()) else {
                continue;
            };
            for f in files.flatten() {
                let path = f.path();
                let Ok(meta) = f.metadata() else { continue };
                let mtime = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
                match path.extension().and_then(|e| e.to_str()) {
                    Some("lpc") => out.push((mtime, meta.len(), path)),
                    Some("tmp") if mtime.elapsed().is_ok_and(|a| a > TMP_MAX_AGE) => {
                        let _ = fs::remove_file(&path);
                    }
                    _ => {}
                }
            }
        }
        out
    }

    fn sweep(&self) {
        let mut entries = self.entries();
        let mut total: u64 = entries.iter().map(|e| e.1).sum();
        if total > self.cap {
            let target = (self.cap as f64 * SWEEP_TARGET) as u64;
            entries.sort_unstable_by_key(|e| e.0);
            for (_, len, path) in entries {
                if total <= target {
                    break;
                }
                let _ = fs::remove_file(&path);
                total = total.saturating_sub(len);
                self.evictions.fetch_add(1, Ordering::Relaxed);
            }
        }
        self.estimate.store(total, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn enc(n: usize) -> Arc<Encoded> {
        Arc::new(Encoded {
            bytes: vec![7; n],
            mime: "image/jpeg",
            width: 3,
            height: 2,
        })
    }

    fn temp_root(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("lpview-disk-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn round_trips_and_rejects_other_ids_and_garbage() {
        let e = enc(100);
        let data = serialize("thumb|a", &e);
        let back = deserialize("thumb|a", &data).unwrap().unwrap();
        assert_eq!(
            (back.bytes, back.mime, back.width, back.height),
            (e.bytes.clone(), "image/jpeg", 3, 2)
        );
        assert!(matches!(deserialize("thumb|b", &data), Ok(None)));
        assert!(deserialize("thumb|a", &data[..data.len() - 1]).is_err());
        assert!(deserialize("thumb|a", b"nope").is_err());
    }

    #[test]
    fn stores_in_the_background_and_survives_reopen() {
        let root = temp_root("reopen");
        let c = DiskCache::open(root.clone(), 1 << 20).unwrap();
        assert!(c.get("x").is_none());
        c.put("x".into(), enc(50));
        c.flush();
        assert!(c.contains("x"));
        assert_eq!(c.get("x").unwrap().bytes.len(), 50);
        let c2 = DiskCache::open(root.clone(), 1 << 20).unwrap();
        assert_eq!(c2.get("x").unwrap().width, 3);
        assert_eq!(c.stats().hits, 1);
        assert_eq!(c.stats().writes, 1);
        let f = c.file_of("x");
        let data = fs::read(&f).unwrap();
        fs::write(&f, &data[..data.len() - 3]).unwrap();
        assert!(c.get("x").is_none());
        assert!(!f.exists());
        assert!(c.clear() == 0);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn sweeps_least_recently_used_over_the_cap() {
        let root = temp_root("sweep");
        let writer = DiskCache::open(root.clone(), 1 << 20).unwrap();
        for i in 0..6 {
            writer.put(format!("k{i}"), enc(2900));
        }
        writer.flush();
        let c = DiskCache::open(root.clone(), 10_000).unwrap();
        let past = SystemTime::now() - Duration::from_secs(7200);
        for i in 0..6 {
            let f = fs::File::options()
                .write(true)
                .open(c.file_of(&format!("k{i}")))
                .unwrap();
            f.set_modified(past + Duration::from_secs(i * 10)).unwrap();
        }
        assert!(c.get("k1").is_some(), "a hit on an old entry refreshes it");
        c.sweep();
        assert!(c.disk_bytes() <= 9_000, "{}", c.disk_bytes());
        assert!(!c.contains("k0") && !c.contains("k2"));
        assert!(c.contains("k1") && c.contains("k5"));
        assert_eq!(c.stats().evictions, 3);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn writes_over_the_cap_trigger_a_sweep() {
        let root = temp_root("autosweep");
        let c = DiskCache::open(root.clone(), 10_000).unwrap();
        for i in 0..8 {
            c.put(format!("k{i}"), enc(2900));
        }
        c.flush();
        assert!(c.disk_bytes() <= 10_000, "{}", c.disk_bytes());
        assert!(c.contains("k7"), "the newest entry survives");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn concurrent_writers_of_one_id_leave_a_valid_file() {
        let root = temp_root("race");
        let a = DiskCache::open(root.clone(), 1 << 24).unwrap();
        let b = DiskCache::open(root.clone(), 1 << 24).unwrap();
        for _ in 0..50 {
            a.put("same".into(), enc(20_000));
            b.put("same".into(), enc(20_000));
        }
        let readers: Vec<_> = (0..4)
            .map(|_| {
                let c = a.clone();
                std::thread::spawn(move || {
                    for _ in 0..200 {
                        if let Some(e) = c.get("same") {
                            assert_eq!(e.bytes.len(), 20_000);
                        }
                    }
                })
            })
            .collect();
        for r in readers {
            r.join().unwrap();
        }
        a.flush();
        b.flush();
        assert_eq!(a.get("same").unwrap().bytes.len(), 20_000);
        let leftovers = fs::read_dir(a.file_of("same").parent().unwrap())
            .unwrap()
            .flatten()
            .filter(|f| f.path().extension().is_some_and(|e| e == "tmp"))
            .count();
        assert_eq!(leftovers, 0);
        fs::remove_dir_all(&root).ok();
    }
}
