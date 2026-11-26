use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender, channel};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notify::event::{ModifyKind, RenameMode};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;

use super::FsEntry;
use super::files::{file_stat, is_within, normalize_dir, skip_dir, walk_each};

pub const QUIET: Duration = Duration::from_millis(350);
pub const MAX_WAIT: Duration = Duration::from_secs(2);

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Renamed {
    pub from: String,
    pub to: String,
    pub dir: bool,
}

#[derive(Serialize, Debug, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct FsChanges {
    pub root: String,
    pub created: Vec<FsEntry>,
    pub modified: Vec<FsEntry>,
    pub removed: Vec<String>,
    pub renamed: Vec<Renamed>,
}

impl FsChanges {
    pub fn is_empty(&self) -> bool {
        self.created.is_empty()
            && self.modified.is_empty()
            && self.removed.is_empty()
            && self.renamed.is_empty()
    }
}

#[derive(Default, Debug)]
pub struct Pending {
    touched: BTreeMap<PathBuf, bool>,
    renames: Vec<(PathBuf, PathBuf)>,
    rename_from: Option<PathBuf>,
    unpaired_names: Vec<PathBuf>,
}

impl Pending {
    fn touch(&mut self, p: PathBuf, appeared: bool) {
        let e = self.touched.entry(p).or_insert(false);
        *e |= appeared;
    }

    fn rename(&mut self, from: PathBuf, to: PathBuf) {
        if let Some(r) = self.renames.iter_mut().find(|(_, t)| *t == from) {
            r.1 = to;
        } else if !self.renames.iter().any(|r| r.0 == from && r.1 == to) {
            self.renames.push((from, to));
        }
    }

    pub fn ingest(&mut self, ev: notify::Event) {
        let mut paths = ev.paths.into_iter();
        match ev.kind {
            EventKind::Access(_) => {}
            EventKind::Create(_) => paths.for_each(|p| self.touch(p, true)),
            EventKind::Modify(ModifyKind::Name(RenameMode::From)) => {
                if let Some(prev) = self.rename_from.take() {
                    self.touch(prev, false);
                }
                self.rename_from = paths.next();
            }
            EventKind::Modify(ModifyKind::Name(RenameMode::To)) => {
                for to in paths {
                    match self.rename_from.take() {
                        Some(from) => self.rename(from, to),
                        None => self.touch(to, true),
                    }
                }
            }
            EventKind::Modify(ModifyKind::Name(RenameMode::Both)) => {
                if let (Some(from), Some(to)) = (paths.next(), paths.next()) {
                    self.rename(from, to);
                }
            }
            EventKind::Modify(ModifyKind::Name(RenameMode::Any)) => {
                self.unpaired_names.extend(paths);
            }
            _ => paths.for_each(|p| self.touch(p, false)),
        }
    }

    fn pair_names(&mut self) {
        let names = std::mem::take(&mut self.unpaired_names);
        let mut i = 0;
        while i < names.len() {
            let here = &names[i];
            match names.get(i + 1) {
                Some(next) if next != here && !here.exists() && next.exists() => {
                    self.rename(here.clone(), next.clone());
                    i += 2;
                }
                _ => {
                    self.touch(here.clone(), here.exists());
                    i += 1;
                }
            }
        }
    }

    pub fn resolve(mut self, root: &str) -> FsChanges {
        if let Some(from) = self.rename_from.take() {
            self.touch(from, false);
        }
        self.pair_names();
        let mut out = FsChanges {
            root: root.to_string(),
            ..Default::default()
        };
        let mut created: BTreeMap<String, FsEntry> = BTreeMap::new();
        let mut modified: BTreeMap<String, FsEntry> = BTreeMap::new();
        let mut removed: HashSet<String> = HashSet::new();
        let inside = |p: &Path| watched(root, p);
        for (from, to) in std::mem::take(&mut self.renames) {
            self.touched.remove(&from);
            self.touched.remove(&to);
            let (from_in, to_in) = (inside(&from), inside(&to));
            let from_s = from.to_string_lossy().into_owned();
            match std::fs::metadata(&to) {
                Ok(m) if to_in && from_in && !from.exists() => {
                    let dir = m.is_dir();
                    if dir || file_stat(&to, &m).is_some() {
                        out.renamed.push(Renamed {
                            from: from_s,
                            to: to.to_string_lossy().into_owned(),
                            dir,
                        });
                    } else {
                        removed.insert(from_s);
                    }
                }
                Ok(_) if to_in => {
                    if from_in && !from.exists() {
                        removed.insert(from_s);
                    }
                    add_created(&mut created, &to);
                }
                _ => {
                    if from_in && !from.exists() {
                        removed.insert(from_s);
                    }
                }
            }
        }
        for (p, appeared) in std::mem::take(&mut self.touched) {
            if !inside(&p) || p.as_os_str() == root {
                continue;
            }
            match std::fs::metadata(&p) {
                Ok(m) if m.is_dir() => {
                    if appeared {
                        add_created(&mut created, &p);
                    }
                }
                Ok(m) => {
                    if let Some(s) = file_stat(&p, &m) {
                        if appeared {
                            created.insert(s.path.clone(), s.into());
                        } else {
                            modified.insert(s.path.clone(), s.into());
                        }
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    removed.insert(p.to_string_lossy().into_owned());
                }
                Err(_) => {}
            }
        }
        modified.retain(|k, _| !created.contains_key(k));
        out.created = created.into_values().collect();
        out.modified = modified.into_values().collect();
        out.removed = removed.into_iter().collect();
        out.removed.sort();
        out
    }
}

fn add_created(created: &mut BTreeMap<String, FsEntry>, p: &Path) {
    match std::fs::metadata(p) {
        Ok(m) if m.is_dir() => {
            let _ = walk_each(p, |s| {
                created.insert(s.path.clone(), s.into());
                true
            });
        }
        Ok(m) => {
            if let Some(s) = file_stat(p, &m) {
                created.insert(s.path.clone(), s.into());
            }
        }
        Err(_) => {}
    }
}

pub fn rebase(p: PathBuf, real: &Path, root: &Path) -> PathBuf {
    match p.strip_prefix(real) {
        Ok(rest) if rest.as_os_str().is_empty() => root.to_path_buf(),
        Ok(rest) => root.join(rest),
        Err(_) => p,
    }
}

fn real_root(root: &str) -> Option<PathBuf> {
    let real = std::fs::canonicalize(root).ok()?;
    (cfg!(target_os = "macos") && real != Path::new(root)).then_some(real)
}

fn watched(root: &str, p: &Path) -> bool {
    let ps = p.to_string_lossy();
    if !is_within(&ps, root) {
        return false;
    }
    let rel = &ps[root.trim_end_matches(std::path::MAIN_SEPARATOR).len()..];
    let mut parts: Vec<&str> = rel.split(['/', '\\']).filter(|s| !s.is_empty()).collect();
    parts.pop();
    !parts.into_iter().any(skip_dir)
        && !p
            .file_name()
            .is_some_and(|n| p.is_dir() && skip_dir(&n.to_string_lossy()))
}

type Emit = Arc<dyn Fn(FsChanges) + Send + Sync>;

pub struct WatchService {
    watchers: Mutex<HashMap<String, RecommendedWatcher>>,
    tx: Sender<(String, notify::Event)>,
}

impl WatchService {
    pub fn new(
        quiet: Duration,
        max_wait: Duration,
        emit: impl Fn(FsChanges) + Send + Sync + 'static,
    ) -> WatchService {
        let (tx, rx) = channel();
        let emit: Emit = Arc::new(emit);
        let _ = std::thread::Builder::new()
            .name("lpview-fs-watch".into())
            .spawn(move || debounce_loop(rx, quiet, max_wait, emit));
        WatchService {
            watchers: Mutex::new(HashMap::new()),
            tx,
        }
    }

    pub fn watch(&self, root: &str) -> Result<String, String> {
        let root = normalize_dir(root);
        if !Path::new(&root).is_dir() {
            return Err(format!("{root} is not a folder"));
        }
        let tx = self.tx.clone();
        let name = root.clone();
        let real = real_root(&root);
        let mut w = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            if let Ok(mut ev) = res {
                if let Some(real) = &real {
                    let shown = Path::new(&name);
                    ev.paths = ev
                        .paths
                        .into_iter()
                        .map(|p| rebase(p, real, shown))
                        .collect();
                }
                let _ = tx.send((name.clone(), ev));
            }
        })
        .map_err(|e| e.to_string())?;
        w.watch(Path::new(&root), RecursiveMode::Recursive)
            .map_err(|e| format!("{root}: {e}"))?;
        self.watchers.lock().unwrap().insert(root.clone(), w);
        Ok(root)
    }

    pub fn unwatch(&self, root: &str) -> bool {
        self.watchers
            .lock()
            .unwrap()
            .remove(&normalize_dir(root))
            .is_some()
    }
}

fn debounce_loop(
    rx: Receiver<(String, notify::Event)>,
    quiet: Duration,
    max_wait: Duration,
    emit: Emit,
) {
    let mut pending: HashMap<String, (Pending, Instant, Instant)> = HashMap::new();
    loop {
        let now = Instant::now();
        let due = |first: Instant, last: Instant| (last + quiet).min(first + max_wait);
        let next = pending.values().map(|(_, f, l)| due(*f, *l)).min();
        let got = match next {
            None => rx.recv().map_err(|_| RecvTimeoutError::Disconnected),
            Some(at) => rx.recv_timeout(at.saturating_duration_since(now)),
        };
        match got {
            Ok((root, ev)) => {
                let now = Instant::now();
                let slot = pending
                    .entry(root)
                    .or_insert_with(|| (Pending::default(), now, now));
                slot.0.ingest(ev);
                slot.2 = now;
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }
        let now = Instant::now();
        let ready: Vec<String> = pending
            .iter()
            .filter(|(_, (_, f, l))| due(*f, *l) <= now)
            .map(|(r, _)| r.clone())
            .collect();
        for root in ready {
            if let Some((p, _, _)) = pending.remove(&root) {
                let changes = p.resolve(&root);
                if !changes.is_empty() {
                    emit(changes);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::tests::temp_dir;
    use notify::event::{CreateKind, DataChange, RemoveKind};

    fn ev(kind: EventKind, paths: &[&Path]) -> notify::Event {
        notify::Event {
            kind,
            paths: paths.iter().map(|p| p.to_path_buf()).collect(),
            attrs: Default::default(),
        }
    }

    fn names(entries: &[FsEntry]) -> Vec<&str> {
        entries.iter().map(|e| e.name.as_str()).collect()
    }

    #[test]
    fn resolves_a_batch_against_the_disk() {
        let dir = temp_dir("resolve");
        let root = dir.to_string_lossy().into_owned();
        let (a, b, c, gone, txt) = (
            dir.join("a.jpg"),
            dir.join("b.jpg"),
            dir.join("c.heic"),
            dir.join("gone.jpg"),
            dir.join("notes.txt"),
        );
        let moved_in = dir.join("Trip");
        std::fs::create_dir_all(&moved_in).unwrap();
        std::fs::write(moved_in.join("t1.cr3"), b"raw").unwrap();
        std::fs::write(moved_in.join("t2.jpg"), b"j").unwrap();
        std::fs::write(&b, b"bb").unwrap();
        std::fs::write(&c, b"c").unwrap();
        std::fs::write(&txt, b"t").unwrap();
        std::fs::create_dir_all(dir.join(".cache")).unwrap();
        std::fs::write(dir.join(".cache").join("h.jpg"), b"h").unwrap();
        let renamed_to = dir.join("renamed.jpg");
        std::fs::write(&renamed_to, b"r").unwrap();

        let mut p = Pending::default();
        p.ingest(ev(EventKind::Create(CreateKind::File), &[&a]));
        p.ingest(ev(
            EventKind::Modify(ModifyKind::Data(DataChange::Any)),
            &[&b],
        ));
        p.ingest(ev(EventKind::Create(CreateKind::File), &[&c]));
        p.ingest(ev(EventKind::Modify(ModifyKind::Any), &[&c]));
        p.ingest(ev(EventKind::Remove(RemoveKind::File), &[&gone]));
        p.ingest(ev(EventKind::Create(CreateKind::File), &[&txt]));
        p.ingest(ev(EventKind::Create(CreateKind::Folder), &[&moved_in]));
        p.ingest(ev(
            EventKind::Create(CreateKind::File),
            &[&dir.join(".cache").join("h.jpg")],
        ));
        let old = dir.join("old.jpg");
        p.ingest(ev(
            EventKind::Modify(ModifyKind::Name(RenameMode::From)),
            &[&old],
        ));
        p.ingest(ev(
            EventKind::Modify(ModifyKind::Name(RenameMode::To)),
            &[&renamed_to],
        ));
        let sub_from = dir.join("Old folder");
        let sub_to = dir.join("New folder");
        std::fs::create_dir_all(&sub_to).unwrap();
        p.ingest(ev(
            EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
            &[&sub_from, &sub_to],
        ));
        p.ingest(ev(
            EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
            &[&sub_from, &sub_to],
        ));
        let outside = temp_dir("resolve-outside").join("x.jpg");
        std::fs::write(&outside, b"x").unwrap();
        let was_inside = dir.join("x.jpg");
        p.ingest(ev(
            EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
            &[&was_inside, &outside],
        ));
        p.ingest(ev(EventKind::Access(notify::event::AccessKind::Any), &[&b]));

        let out = p.resolve(&root);
        assert_eq!(out.root, root);
        assert_eq!(
            names(&out.created),
            ["t1.cr3", "t2.jpg", "c.heic"],
            "by path: Trip/ before c.heic"
        );
        assert_eq!(names(&out.modified), ["b.jpg"]);
        assert_eq!(out.modified[0].size, 2);
        let mut removed = vec![
            a.to_string_lossy().into_owned(),
            gone.to_string_lossy().into_owned(),
            was_inside.to_string_lossy().into_owned(),
        ];
        removed.sort();
        assert_eq!(out.removed, removed);
        assert_eq!(
            out.renamed,
            [
                Renamed {
                    from: old.to_string_lossy().into_owned(),
                    to: renamed_to.to_string_lossy().into_owned(),
                    dir: false
                },
                Renamed {
                    from: sub_from.to_string_lossy().into_owned(),
                    to: sub_to.to_string_lossy().into_owned(),
                    dir: true
                },
            ]
        );
        let json = serde_json::to_value(&out).unwrap();
        let keys: Vec<_> = json.as_object().unwrap().keys().cloned().collect();
        assert_eq!(keys, ["created", "modified", "removed", "renamed", "root"]);
        assert!(json["created"][0]["mtimeMs"].is_i64());
        std::fs::remove_dir_all(&dir).unwrap();
        std::fs::remove_dir_all(outside.parent().unwrap()).unwrap();
    }

    #[test]
    fn names_changed_one_by_one_pair_up_into_renames() {
        let dir = temp_dir("names");
        let root = dir.to_string_lossy().into_owned();
        let (a, b, c, d) = (
            dir.join("a.jpg"),
            dir.join("b.jpg"),
            dir.join("c.jpg"),
            dir.join("d.jpg"),
        );
        std::fs::write(&b, b"1").unwrap();
        std::fs::write(&c, b"2").unwrap();
        let name = EventKind::Modify(ModifyKind::Name(RenameMode::Any));
        let mut p = Pending::default();
        p.ingest(ev(name, &[&a]));
        p.ingest(ev(name, &[&b]));
        p.ingest(ev(name, &[&c]));
        p.ingest(ev(name, &[&d]));
        let out = p.resolve(&root);
        assert_eq!(
            out.renamed,
            [Renamed {
                from: a.to_string_lossy().into_owned(),
                to: b.to_string_lossy().into_owned(),
                dir: false
            }]
        );
        let created: Vec<_> = out.created.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(created, ["c.jpg"]);
        assert_eq!(out.removed, [d.to_string_lossy().into_owned()]);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn events_under_a_symlinked_root_come_back_under_the_root_that_was_watched() {
        let real = Path::new("/private/var/folders/x/T/lib");
        let root = Path::new("/var/folders/x/T/lib");
        assert_eq!(
            rebase(real.join("a").join("b.jpg"), real, root),
            root.join("a").join("b.jpg")
        );
        assert_eq!(rebase(real.to_path_buf(), real, root), root);
        assert_eq!(
            rebase(PathBuf::from("/elsewhere/c.jpg"), real, root),
            PathBuf::from("/elsewhere/c.jpg")
        );
    }

    #[test]
    fn a_real_watcher_reports_one_debounced_batch() {
        let dir = temp_dir("watcher");
        let (tx, rx) = std::sync::mpsc::channel();
        let svc = WatchService::new(
            Duration::from_millis(150),
            Duration::from_secs(2),
            move |c| tx.send(c).unwrap(),
        );
        let root = svc.watch(dir.to_str().unwrap()).unwrap();
        assert!(svc.watch(dir.join("nope").to_str().unwrap()).is_err());
        std::thread::sleep(Duration::from_millis(100));
        std::fs::write(dir.join("one.jpg"), b"1").unwrap();
        std::fs::write(dir.join("two.png"), b"2").unwrap();
        std::fs::write(dir.join("skip.txt"), b"3").unwrap();
        let first = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(first.root, root);
        let mut got: Vec<_> = first
            .created
            .iter()
            .chain(&first.modified)
            .map(|e| e.name.clone())
            .collect();
        got.sort();
        got.dedup();
        assert_eq!(got, ["one.jpg", "two.png"]);
        assert!(
            rx.recv_timeout(Duration::from_millis(400)).is_err(),
            "one batch"
        );

        std::fs::rename(dir.join("one.jpg"), dir.join("uno.jpg")).unwrap();
        std::fs::remove_file(dir.join("two.png")).unwrap();
        let second = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(
            second.renamed,
            [Renamed {
                from: dir.join("one.jpg").to_string_lossy().into_owned(),
                to: dir.join("uno.jpg").to_string_lossy().into_owned(),
                dir: false
            }]
        );
        assert_eq!(
            second.removed,
            [dir.join("two.png").to_string_lossy().into_owned()]
        );
        assert!(svc.unwatch(&root));
        std::thread::sleep(Duration::from_millis(100));
        std::fs::write(dir.join("after.jpg"), b"x").unwrap();
        assert!(rx.recv_timeout(Duration::from_millis(600)).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
