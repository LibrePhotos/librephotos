//! The local library (CONTRACT.md "Library"): folders the user added, indexed in SQLite and
//! watched for changes.
//!
//! - Adding a root walks it (stat only: `read_dir` gives sizes and times for free on Windows),
//!   inserts every supported file at once, then a metadata pass reads EXIF/RAW headers (no
//!   pixels) newest first on a few threads and fills in dates, sizes, camera and search words.
//! - Each root has a recursive `notify` watcher; events are debounced and reconciled by path:
//!   whatever exists is (re)stat-ed, whatever vanished is deleted. A file that vanishes and a file
//!   of the same size and modified time that appears in the same batch is a rename or move: the
//!   new row takes over the old one's MD5 and server state.
//! - On start every root is walked again and compared by size and modified time, so changes
//!   made while the app was closed are picked up; only changed files are read again.

pub mod db;
pub mod search;

use std::collections::{HashMap, HashSet};
use std::path::{MAIN_SEPARATOR, Path, PathBuf};
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender, channel};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use chrono::{Local, NaiveDateTime, TimeZone};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use rusqlite::Connection;
use serde::Serialize;

use crate::formats::kind_of;
use crate::listing::modified_ms;
use db::{FileStat, LibraryFile, Root};

/// Watch events are handled once the folder has been quiet this long...
const DEBOUNCE: Duration = Duration::from_millis(350);
/// ...or at the latest after this long (a long copy still shows up as it goes).
const DEBOUNCE_MAX: Duration = Duration::from_secs(2);
/// Files whose metadata is read per batch (one transaction, one `changed` event).
const META_BATCH: i64 = 256;
const META_THREADS: usize = 4;

/// Something the UI should hear about.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum LibraryEvent {
    /// Files were added, changed, removed or got their metadata: lists should be fetched again.
    Changed,
    /// Indexing progress: `walking` while roots are listed, `pending` files still to read.
    Progress {
        walking: bool,
        files: i64,
        pending: i64,
    },
}

type Emit = Box<dyn Fn(LibraryEvent) + Send + Sync>;

pub struct Library {
    conn: Mutex<Connection>,
    emit: Emit,
    /// Called when files appear whose server state is unknown (wakes the server worker).
    on_new: Mutex<Option<Box<dyn Fn() + Send + Sync>>>,
    watchers: Mutex<HashMap<i64, RecommendedWatcher>>,
    watch_tx: Mutex<Option<Sender<PathBuf>>>,
    meta_wake: (Mutex<bool>, Condvar),
    walking: Mutex<HashSet<i64>>,
}

/// `C:\Pics\` -> `C:\Pics`; on Windows also `/` -> `\`.
pub fn normalize_dir(p: &str) -> String {
    let p = if cfg!(windows) {
        p.replace('/', "\\")
    } else {
        p.to_string()
    };
    let trimmed = p.trim_end_matches(['\\', '/']);
    // Keep the separator of a drive root ("C:\") and of "/".
    if trimmed.is_empty() || trimmed.ends_with(':') {
        return p;
    }
    trimmed.to_string()
}

fn same_path(a: &str, b: &str) -> bool {
    if cfg!(windows) {
        a.eq_ignore_ascii_case(b)
    } else {
        a == b
    }
}

/// Whether `path` is `dir` or inside it.
pub fn is_within(path: &str, dir: &str) -> bool {
    if same_path(path, dir) {
        return true;
    }
    let dir = dir.trim_end_matches(MAIN_SEPARATOR);
    path.len() > dir.len()
        && path.as_bytes()[dir.len()] == MAIN_SEPARATOR as u8
        && path.is_char_boundary(dir.len())
        && same_path(&path[..dir.len()], dir)
}

/// Local wall-clock milliseconds of a UTC instant (what `taken_ms` holds for undated files).
pub fn local_wall_ms(utc_ms: i64) -> i64 {
    Local
        .timestamp_millis_opt(utc_ms)
        .single()
        .map(|d| d.naive_local().and_utc().timestamp_millis())
        .unwrap_or(utc_ms)
}

/// "2023-03-15T10:00:00" (local, from EXIF) as wall-clock milliseconds.
pub fn taken_ms(iso: &str) -> Option<i64> {
    let s = iso.get(..19)?;
    NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S")
        .ok()
        .map(|d| d.and_utc().timestamp_millis())
}

pub fn file_stat(path: &Path, meta: &std::fs::Metadata) -> Option<FileStat> {
    let kind = kind_of(path)?;
    meta.is_file().then(|| FileStat {
        path: path.to_string_lossy().into_owned(),
        folder: path
            .parent()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default(),
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        size: meta.len() as i64,
        mtime: modified_ms(meta),
        kind,
    })
}

fn skip_dir(name: &str) -> bool {
    name.starts_with('.')
        || name.eq_ignore_ascii_case("$RECYCLE.BIN")
        || name.eq_ignore_ascii_case("System Volume Information")
        || name == "@eaDir"
}

/// Every supported file under `dir` (recursive, hidden folders skipped).
pub fn walk(dir: &Path) -> std::io::Result<Vec<FileStat>> {
    let mut out = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    let mut first = true;
    while let Some(d) = stack.pop() {
        let entries = match std::fs::read_dir(&d) {
            Ok(e) => e,
            // The root itself must be readable; a subfolder we may not read is skipped.
            Err(e) if first => return Err(e),
            Err(_) => continue,
        };
        first = false;
        for entry in entries.flatten() {
            let Ok(ft) = entry.file_type() else { continue };
            let path = entry.path();
            if ft.is_dir() {
                if !skip_dir(&entry.file_name().to_string_lossy()) {
                    stack.push(path);
                }
            } else if ft.is_file()
                && kind_of(&path).is_some()
                && let Ok(meta) = entry.metadata()
                && let Some(s) = file_stat(&path, &meta)
            {
                out.push(s);
            }
        }
    }
    Ok(out)
}

/// Metadata of a file without decoding pixels (the info panel's reader).
pub fn read_meta(path: &str) -> Option<db::Meta> {
    let info = crate::info::image_info(path).ok()?;
    let camera = match (info.camera_make, info.camera_model) {
        (Some(make), Some(model)) if model.to_lowercase().starts_with(&make.to_lowercase()) => {
            Some(model)
        }
        (Some(make), Some(model)) => Some(format!("{make} {model}")),
        (a, b) => a.or(b),
    };
    Some(db::Meta {
        width: info.width,
        height: info.height,
        taken_at: info.taken_at,
        camera,
        lens: info.lens,
        lat: info.gps.map(|g| g.lat),
        lon: info.gps.map(|g| g.lon),
        format: info.format,
    })
}

impl Library {
    pub fn open(
        conn: Connection,
        emit: impl Fn(LibraryEvent) + Send + Sync + 'static,
    ) -> Arc<Library> {
        Arc::new(Library {
            conn: Mutex::new(conn),
            emit: Box::new(emit),
            on_new: Mutex::new(None),
            watchers: Mutex::new(HashMap::new()),
            watch_tx: Mutex::new(None),
            meta_wake: (Mutex::new(false), Condvar::new()),
            walking: Mutex::new(HashSet::new()),
        })
    }

    /// The database, for the server worker and the commands.
    pub fn conn(&self) -> MutexGuard<'_, Connection> {
        self.conn.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Tells the UI to fetch its lists again (server state changed).
    pub fn notify_changed(&self) {
        (self.emit)(LibraryEvent::Changed);
    }

    pub fn set_on_new(&self, f: impl Fn() + Send + Sync + 'static) {
        *self.on_new.lock().unwrap() = Some(Box::new(f));
    }

    fn new_files(&self) {
        if let Some(f) = self.on_new.lock().unwrap().as_ref() {
            f();
        }
    }

    /// Starts the metadata worker, the watchers and a walk of every root.
    pub fn start(self: &Arc<Self>) {
        let me = self.clone();
        let _ = std::thread::Builder::new()
            .name("lpview-library-meta".into())
            .spawn(move || me.meta_loop());
        let (tx, rx) = channel();
        *self.watch_tx.lock().unwrap() = Some(tx);
        let me = self.clone();
        let _ = std::thread::Builder::new()
            .name("lpview-library-watch".into())
            .spawn(move || me.watch_loop(rx));
        let roots = self.roots().unwrap_or_default();
        for r in &roots {
            self.watch(r);
        }
        let me = self.clone();
        let _ = std::thread::Builder::new()
            .name("lpview-library-scan".into())
            .spawn(move || {
                for r in roots {
                    me.scan_root(&r);
                }
            });
    }

    pub fn roots(&self) -> Result<Vec<Root>, String> {
        db::roots(&self.conn()).map_err(|e| e.to_string())
    }

    /// Adds a folder; a folder inside an existing root is already in the library (that root is
    /// returned), roots inside the new folder are merged into it.
    pub fn add_root(self: &Arc<Self>, path: &str) -> Result<Root, String> {
        let path = normalize_dir(path);
        if !Path::new(&path).is_dir() {
            return Err(format!("{path} is not a folder"));
        }
        let existing = self.roots()?;
        if let Some(r) = existing.iter().find(|r| is_within(&path, &r.path)) {
            return Ok(r.clone());
        }
        let id = {
            let conn = self.conn();
            let id = db::add_root(&conn, &path, chrono::Utc::now().timestamp_millis())
                .map_err(|e| e.to_string())?;
            for r in existing.iter().filter(|r| is_within(&r.path, &path)) {
                db::merge_root(&conn, r.id, id).map_err(|e| e.to_string())?;
                self.watchers.lock().unwrap().remove(&r.id);
            }
            id
        };
        let root = self
            .roots()?
            .into_iter()
            .find(|r| r.id == id)
            .ok_or("the folder vanished")?;
        self.watch(&root);
        Ok(root)
    }

    /// [`Library::add_root`], then a walk of it in the background.
    pub fn add_root_and_scan(self: &Arc<Self>, path: &str) -> Result<Root, String> {
        let root = self.add_root(path)?;
        let me = self.clone();
        let r = root.clone();
        let _ = std::thread::Builder::new()
            .name("lpview-library-scan".into())
            .spawn(move || me.scan_root(&r));
        Ok(root)
    }

    pub fn remove_root(&self, id: i64) -> Result<(), String> {
        self.watchers.lock().unwrap().remove(&id);
        db::remove_root(&mut self.conn(), id).map_err(|e| e.to_string())?;
        (self.emit)(LibraryEvent::Changed);
        Ok(())
    }

    pub fn files(&self, root_id: Option<i64>) -> Result<Vec<LibraryFile>, String> {
        db::list(&self.conn(), root_id).map_err(|e| e.to_string())
    }

    pub fn search(&self, q: &str, limit: i64) -> Result<Vec<LibraryFile>, String> {
        let Some(fts) = search::fts_query(q) else {
            return Ok(Vec::new());
        };
        db::search(&self.conn(), &fts, limit).map_err(|e| e.to_string())
    }

    /// The library root holding `path`, if any.
    pub fn root_of(&self, path: &str) -> Option<Root> {
        self.roots()
            .ok()?
            .into_iter()
            .find(|r| is_within(path, &r.path))
    }

    fn watch(self: &Arc<Self>, root: &Root) {
        let Some(tx) = self.watch_tx.lock().unwrap().clone() else {
            return;
        };
        let w = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            if let Ok(ev) = res {
                if matches!(ev.kind, notify::EventKind::Access(_)) {
                    return;
                }
                for p in ev.paths {
                    let _ = tx.send(p);
                }
            }
        });
        match w {
            Ok(mut w) => {
                if let Err(e) = w.watch(Path::new(&root.path), RecursiveMode::Recursive) {
                    eprintln!("library: can't watch {}: {e}", root.path);
                    return;
                }
                self.watchers.lock().unwrap().insert(root.id, w);
            }
            Err(e) => eprintln!("library: no watcher: {e}"),
        }
    }

    fn progress(&self) {
        let walking = !self.walking.lock().unwrap().is_empty();
        let conn = self.conn();
        let count = |sql: &str| conn.query_row(sql, [], |r| r.get::<_, i64>(0)).unwrap_or(0);
        let files = count("SELECT COUNT(*) FROM files WHERE root_id IS NOT NULL");
        let pending =
            count("SELECT COUNT(*) FROM files WHERE root_id IS NOT NULL AND meta_done = 0");
        drop(conn);
        (self.emit)(LibraryEvent::Progress {
            walking,
            files,
            pending,
        });
    }

    /// Walks a root and brings its rows up to date (new, changed, gone).
    pub fn scan_root(&self, root: &Root) {
        self.walking.lock().unwrap().insert(root.id);
        self.progress();
        let t = Instant::now();
        let result = walk(Path::new(&root.path));
        let walked = t.elapsed();
        match result {
            Ok(found) => {
                let n = found.len();
                let changed = self.apply_walk(root, found);
                if std::env::var_os("LPVIEW_LIBRARY_TRACE").is_some() {
                    eprintln!(
                        "library: walked {} ({n} files) in {walked:?}, {changed} new/changed, applied in {:?}",
                        root.path,
                        t.elapsed() - walked
                    );
                }
            }
            // A root that is not there (unplugged drive) keeps its rows.
            Err(e) => eprintln!("library: can't read {}: {e}", root.path),
        }
        self.walking.lock().unwrap().remove(&root.id);
        self.progress();
    }

    fn apply_walk(&self, root: &Root, found: Vec<FileStat>) -> usize {
        let changed;
        {
            let mut conn = self.conn();
            let known = db::known_files(&conn, root.id).unwrap_or_default();
            let seen: HashSet<&str> = found.iter().map(|f| f.path.as_str()).collect();
            let gone: Vec<String> = known
                .keys()
                .filter(|p| !seen.contains(p.as_str()))
                .cloned()
                .collect();
            let fresh: Vec<&FileStat> = found
                .iter()
                .filter(|f| known.get(&f.path) != Some(&(f.size, f.mtime)))
                .collect();
            changed = fresh.len() + gone.len();
            if changed == 0 {
                return 0;
            }
            let Ok(tx) = conn.transaction() else { return 0 };
            let carries = db::delete_paths(&tx, &gone).unwrap_or_default();
            for f in fresh {
                let carry = take_carry(&carries, f);
                let _ = db::upsert(&tx, Some(root.id), f, local_wall_ms(f.mtime), carry);
            }
            if let Err(e) = tx.commit() {
                eprintln!("library: commit failed: {e}");
            }
        }
        (self.emit)(LibraryEvent::Changed);
        self.wake_meta();
        self.new_files();
        changed
    }

    fn wake_meta(&self) {
        let (m, c) = &self.meta_wake;
        *m.lock().unwrap() = true;
        c.notify_one();
    }

    fn meta_loop(&self) {
        let trace = std::env::var_os("LPVIEW_LIBRARY_TRACE").is_some();
        let mut started: Option<(Instant, usize)> = None;
        loop {
            let batch = db::pending_meta(&self.conn(), META_BATCH).unwrap_or_default();
            if batch.is_empty() {
                if let Some((t, n)) = started.take()
                    && trace
                {
                    eprintln!("library: read metadata of {n} files in {:?}", t.elapsed());
                }
                self.progress();
                let (m, c) = &self.meta_wake;
                let mut woken = m.lock().unwrap();
                while !*woken {
                    woken = c.wait(woken).unwrap();
                }
                *woken = false;
                continue;
            }
            let s = started.get_or_insert((Instant::now(), 0));
            s.1 += batch.len();
            let next = Mutex::new(batch.iter());
            let results = Mutex::new(Vec::with_capacity(batch.len()));
            std::thread::scope(|s| {
                for _ in 0..META_THREADS {
                    s.spawn(|| {
                        loop {
                            let Some((id, path)) = next.lock().unwrap().next().cloned() else {
                                break;
                            };
                            let meta = read_meta(&path).unwrap_or_default();
                            results.lock().unwrap().push((id, meta));
                        }
                    });
                }
            });
            {
                let mut conn = self.conn();
                if let Ok(tx) = conn.transaction() {
                    for (id, meta) in results.into_inner().unwrap() {
                        let ms = meta.taken_at.as_deref().and_then(taken_ms);
                        let _ = db::set_meta(&tx, id, &meta, ms);
                    }
                    let _ = tx.commit();
                }
            }
            (self.emit)(LibraryEvent::Changed);
            self.progress();
        }
    }

    fn watch_loop(&self, rx: Receiver<PathBuf>) {
        while let Ok(first) = rx.recv() {
            let mut paths = HashSet::from([first]);
            let start = Instant::now();
            loop {
                let left = DEBOUNCE_MAX.saturating_sub(start.elapsed());
                if left.is_zero() {
                    break;
                }
                match rx.recv_timeout(DEBOUNCE.min(left)) {
                    Ok(p) => {
                        paths.insert(p);
                    }
                    Err(RecvTimeoutError::Timeout) => break,
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            }
            self.reconcile(paths.into_iter().collect());
        }
    }

    /// Brings the rows of these paths (files or folders, existing or not) up to date.
    pub fn reconcile(&self, paths: Vec<PathBuf>) -> usize {
        let roots = self.roots().unwrap_or_default();
        let mut add: Vec<(i64, FileStat)> = Vec::new();
        let mut gone: Vec<String> = Vec::new();
        let mut seen: HashSet<String> = HashSet::new();
        for p in paths {
            let ps = p.to_string_lossy().into_owned();
            let Some(root) = roots.iter().find(|r| is_within(&ps, &r.path)) else {
                continue;
            };
            match std::fs::metadata(&p) {
                Ok(m) if m.is_dir() => {
                    if same_path(&ps, &root.path) {
                        // The root's own entry: its children have their own events.
                        continue;
                    }
                    let found = walk(&p).unwrap_or_default();
                    let here: HashSet<&str> = found.iter().map(|f| f.path.as_str()).collect();
                    let under = db::paths_under(&self.conn(), &ps).unwrap_or_default();
                    gone.extend(under.into_iter().filter(|u| !here.contains(u.as_str())));
                    for f in found {
                        if seen.insert(f.path.clone()) {
                            add.push((root.id, f));
                        }
                    }
                }
                Ok(m) => {
                    if let Some(f) = file_stat(&p, &m)
                        && seen.insert(f.path.clone())
                    {
                        add.push((root.id, f));
                    }
                }
                Err(_) => {
                    if same_path(&ps, &root.path) {
                        continue;
                    }
                    gone.extend(db::paths_under(&self.conn(), &ps).unwrap_or_default());
                }
            }
        }
        let mut changed = 0;
        {
            let mut conn = self.conn();
            let Ok(tx) = conn.transaction() else { return 0 };
            let carries = db::delete_paths(&tx, &gone).unwrap_or_default();
            changed += carries.len();
            for (root_id, f) in &add {
                let carry = take_carry(&carries, f);
                if db::upsert(&tx, Some(*root_id), f, local_wall_ms(f.mtime), carry)
                    .unwrap_or(false)
                {
                    changed += 1;
                }
            }
            if tx.commit().is_err() {
                return 0;
            }
        }
        if changed > 0 {
            (self.emit)(LibraryEvent::Changed);
            self.wake_meta();
            self.new_files();
        }
        changed
    }

    /// Runs the metadata pass on the calling thread until nothing is pending (tests).
    #[cfg(test)]
    fn read_all_meta(&self) {
        loop {
            let batch = db::pending_meta(&self.conn(), META_BATCH).unwrap_or_default();
            if batch.is_empty() {
                return;
            }
            for (id, path) in batch {
                let meta = read_meta(&path).unwrap_or_default();
                let ms = meta.taken_at.as_deref().and_then(taken_ms);
                db::set_meta(&self.conn(), id, &meta, ms).unwrap();
            }
        }
    }
}

/// The vanished file a new one is a rename of: same size and modified time, same name preferred.
fn take_carry<'a>(carries: &'a [db::Carry], f: &FileStat) -> Option<&'a db::Carry> {
    let mut matches = carries
        .iter()
        .filter(|c| c.size == f.size && c.mtime == f.mtime);
    let first = matches.next()?;
    Some(
        std::iter::once(first)
            .chain(matches)
            .find(|c| c.name == f.name)
            .unwrap_or(first),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("lpview-lib-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn lib() -> Arc<Library> {
        Library::open(db::open_memory().unwrap(), |_| ())
    }

    #[test]
    fn paths_within() {
        let s = MAIN_SEPARATOR;
        let root = format!("C:{s}Pics");
        assert!(is_within(&format!("{root}{s}a.jpg"), &root));
        assert!(is_within(&root, &root));
        assert!(!is_within(&format!("C:{s}Pictures{s}a.jpg"), &root));
        assert_eq!(normalize_dir(&format!("{root}{s}")), root);
    }

    #[test]
    fn dates() {
        assert_eq!(taken_ms("1970-01-01T00:00:01"), Some(1000));
        assert_eq!(
            taken_ms("2023-03-15T10:00:00.123+02:00"),
            taken_ms("2023-03-15T10:00:00")
        );
        assert_eq!(taken_ms("junk"), None);
    }

    #[test]
    fn copies_share_server_state_and_never_upload_twice() {
        let dir = temp_dir("dupes");
        for n in ["a.jpg", "copy of a.jpg", "b.jpg"] {
            std::fs::write(dir.join(n), if n == "b.jpg" { "b" } else { "same" }).unwrap();
        }
        let lib = lib();
        let root = lib.add_root(dir.to_str().unwrap()).unwrap();
        lib.scan_root(&root);
        let conn = lib.conn();
        for f in db::list(&conn, None).unwrap() {
            let md5 = if f.name == "b.jpg" { "bb" } else { "aa" };
            db::set_md5(&conn, f.id, md5).unwrap();
            db::set_remote(&conn, f.id, db::remote::ABSENT, None, None).unwrap();
        }
        // One copy is being uploaded: the other is not handed out meanwhile.
        let first = db::claim_upload(&conn, true, 0).unwrap().unwrap();
        let second = db::claim_upload(&conn, true, 0).unwrap().unwrap();
        assert_ne!(first.md5, second.md5);
        assert!(db::claim_upload(&conn, true, 0).unwrap().is_none());
        let a = if first.md5.as_deref() == Some("aa") {
            &first
        } else {
            &second
        };
        db::set_remote(&conn, a.id, db::remote::PRESENT, Some("p1"), None).unwrap();
        let present: Vec<_> = db::list(&conn, None)
            .unwrap()
            .into_iter()
            .filter(|f| f.remote == "present")
            .map(|f| f.remote_id)
            .collect();
        assert_eq!(present, [Some("p1".to_string()), Some("p1".to_string())]);
        drop(conn);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn scans_searches_and_follows_renames() {
        let dir = temp_dir("scan");
        std::fs::create_dir_all(dir.join("Italy 2019")).unwrap();
        std::fs::create_dir_all(dir.join(".hidden")).unwrap();
        for n in [
            "Italy 2019/a.jpg",
            "b.png",
            "notes.txt",
            ".hidden/c.jpg",
            "clip.mp4",
        ] {
            std::fs::write(dir.join(n), n.as_bytes()).unwrap();
        }
        let lib = lib();
        let root = lib.add_root(dir.to_str().unwrap()).unwrap();
        lib.scan_root(&root);
        lib.read_all_meta();
        let files = lib.files(None).unwrap();
        let mut names: Vec<_> = files.iter().map(|f| f.name.as_str()).collect();
        names.sort();
        assert_eq!(names, ["a.jpg", "b.png", "clip.mp4"]);
        assert_eq!(lib.search("italy", 10).unwrap().len(), 1);
        assert_eq!(lib.search("video", 10).unwrap()[0].name, "clip.mp4");
        assert_eq!(lib.search("png", 10).unwrap()[0].name, "b.png");
        assert!(lib.search("nothing-like-this", 10).unwrap().is_empty());

        // The server learned about a.jpg; a rename keeps that.
        let a = files.iter().find(|f| f.name == "a.jpg").unwrap();
        db::set_md5(&lib.conn(), a.id, "abc").unwrap();
        db::set_remote(&lib.conn(), a.id, db::remote::PRESENT, Some("uuid-1"), None).unwrap();
        let from = dir.join("Italy 2019").join("a.jpg");
        let to = dir.join("renamed.jpg");
        std::fs::rename(&from, &to).unwrap();
        assert_eq!(lib.reconcile(vec![from, to.clone()]), 2);
        let moved = db::by_path(&lib.conn(), to.to_str().unwrap())
            .unwrap()
            .unwrap();
        assert_eq!(moved.md5.as_deref(), Some("abc"));
        assert_eq!(moved.remote, "present");
        assert_eq!(moved.remote_id.as_deref(), Some("uuid-1"));

        // A deleted folder takes its files along.
        std::fs::write(dir.join("Italy 2019").join("d.jpg"), b"d").unwrap();
        lib.reconcile(vec![dir.join("Italy 2019")]);
        assert_eq!(lib.files(None).unwrap().len(), 4);
        std::fs::remove_dir_all(dir.join("Italy 2019")).unwrap();
        lib.reconcile(vec![dir.join("Italy 2019")]);
        assert_eq!(lib.files(None).unwrap().len(), 3);

        // A modified file loses its hash; a rescan finds files changed while "closed".
        std::fs::write(&to, b"different content").unwrap();
        lib.scan_root(&root);
        let changed = db::by_path(&lib.conn(), to.to_str().unwrap())
            .unwrap()
            .unwrap();
        assert_eq!(changed.md5, None);
        assert_eq!(changed.remote, "unknown");

        // A subfolder is already in the library; a parent folder absorbs the root.
        let sub = dir.join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        assert_eq!(lib.add_root(sub.to_str().unwrap()).unwrap().id, root.id);
        let outer = temp_dir("outer");
        let inner = outer.join("inner");
        std::fs::create_dir_all(&inner).unwrap();
        std::fs::write(inner.join("e.jpg"), b"e").unwrap();
        let inner_root = lib.add_root(inner.to_str().unwrap()).unwrap();
        lib.scan_root(&inner_root);
        assert_eq!(lib.roots().unwrap().len(), 2);
        let outer_root = lib.add_root(outer.to_str().unwrap()).unwrap();
        assert_eq!(lib.roots().unwrap().len(), 2, "inner merged into outer");
        assert_eq!(lib.files(Some(outer_root.id)).unwrap().len(), 1);
        lib.remove_root(outer_root.id).unwrap();
        assert_eq!(lib.files(None).unwrap().len(), 3);
        std::fs::remove_dir_all(&outer).unwrap();
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
