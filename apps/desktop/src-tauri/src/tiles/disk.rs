use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

pub const DEFAULT_CAP_BYTES: u64 = 2 << 30;

pub fn default_root() -> Option<PathBuf> {
    if let Some(v) = std::env::var_os("LPVIEW_TILE_CACHE") {
        return (v != "off").then(|| PathBuf::from(v));
    }
    if let Some(d) = crate::appdirs::override_dir() {
        return Some(d.join("tiles"));
    }
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("XDG_CACHE_HOME").map(PathBuf::from))
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".cache")))?;
    Some(base.join("LibrePhotos Viewer").join("tiles"))
}

struct Dir {
    bytes: u64,
    used: SystemTime,
}

#[derive(Default)]
struct State {
    dirs: HashMap<String, Dir>,
    total: u64,
}

pub struct DiskCache {
    root: PathBuf,
    cap: u64,
    st: Mutex<State>,
}

fn dir_size(p: &Path) -> u64 {
    std::fs::read_dir(p)
        .map(|rd| {
            rd.filter_map(|e| e.ok()?.metadata().ok())
                .filter(|m| m.is_file())
                .map(|m| m.len())
                .sum()
        })
        .unwrap_or(0)
}

impl DiskCache {
    pub fn new(root: PathBuf, cap: u64) -> DiskCache {
        DiskCache {
            root,
            cap,
            st: Mutex::new(State::default()),
        }
    }

    pub fn scan(&self) {
        let Ok(rd) = std::fs::read_dir(&self.root) else {
            return;
        };
        let mut found = Vec::new();
        for e in rd.flatten() {
            let p = e.path();
            if !p.is_dir() {
                continue;
            }
            let used = std::fs::metadata(p.join("used"))
                .or_else(|_| e.metadata())
                .and_then(|m| m.modified())
                .unwrap_or(SystemTime::UNIX_EPOCH);
            found.push((
                e.file_name().to_string_lossy().into_owned(),
                dir_size(&p),
                used,
            ));
        }
        let mut st = self.st.lock().unwrap();
        for (id, bytes, used) in found {
            let d = st.dirs.entry(id).or_insert(Dir { bytes: 0, used });
            d.bytes = d.bytes.max(bytes);
        }
        st.total = st.dirs.values().map(|d| d.bytes).sum();
    }

    fn tile_path(&self, id: &str, level: u32, x: u32, y: u32) -> PathBuf {
        self.root.join(id).join(format!("{level}-{x}-{y}.jpg"))
    }

    pub fn read(&self, id: &str, level: u32, x: u32, y: u32) -> Option<Vec<u8>> {
        std::fs::read(self.tile_path(id, level, x, y)).ok()
    }

    pub fn contains(&self, id: &str, level: u32, x: u32, y: u32) -> bool {
        self.tile_path(id, level, x, y).is_file()
    }

    pub fn write(&self, id: &str, level: u32, x: u32, y: u32, bytes: &[u8]) {
        let p = self.tile_path(id, level, x, y);
        let tmp = p.with_extension("tmp");
        let ok = std::fs::create_dir_all(p.parent().unwrap()).is_ok()
            && std::fs::write(&tmp, bytes).is_ok()
            && std::fs::rename(&tmp, &p).is_ok();
        if !ok {
            let _ = std::fs::remove_file(&tmp);
            return;
        }
        let mut st = self.st.lock().unwrap();
        let d = st.dirs.entry(id.to_string()).or_insert(Dir {
            bytes: 0,
            used: SystemTime::now(),
        });
        d.bytes += bytes.len() as u64;
        st.total += bytes.len() as u64;
    }

    pub fn touch(&self, id: &str) {
        let dir = self.root.join(id);
        if std::fs::create_dir_all(&dir).is_ok() {
            let _ = std::fs::write(dir.join("used"), b"");
        }
        let mut st = self.st.lock().unwrap();
        st.dirs
            .entry(id.to_string())
            .or_insert(Dir {
                bytes: 0,
                used: SystemTime::now(),
            })
            .used = SystemTime::now();
    }

    pub fn mark_level_done(&self, id: &str, level: u32) {
        let _ = std::fs::write(self.root.join(id).join(format!("{level}.done")), b"");
    }

    pub fn level_done(&self, id: &str, level: u32) -> bool {
        self.root.join(id).join(format!("{level}.done")).is_file()
    }

    pub fn total_bytes(&self) -> u64 {
        self.st.lock().unwrap().total
    }

    pub fn evict(&self, keep: &[String]) {
        let victims: Vec<String> = {
            let mut st = self.st.lock().unwrap();
            if st.total <= self.cap {
                return;
            }
            let mut order: Vec<(SystemTime, String, u64)> = st
                .dirs
                .iter()
                .filter(|(id, _)| !keep.contains(id))
                .map(|(id, d)| (d.used, id.clone(), d.bytes))
                .collect();
            order.sort();
            let target = self.cap / 10 * 9;
            let mut out = Vec::new();
            for (_, id, bytes) in order {
                if st.total <= target {
                    break;
                }
                st.total -= bytes;
                st.dirs.remove(&id);
                out.push(id);
            }
            out
        };
        for id in victims {
            let _ = std::fs::remove_dir_all(self.root.join(id));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_reads_and_evicts_lru_folders() {
        let root = std::env::temp_dir().join(format!("lpview-tiles-disk-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let c = DiskCache::new(root.clone(), 1000);
        c.touch("old");
        c.write("old", 0, 0, 0, &[1; 400]);
        std::thread::sleep(std::time::Duration::from_millis(20));
        c.touch("mid");
        c.write("mid", 0, 0, 0, &[2; 400]);
        std::thread::sleep(std::time::Duration::from_millis(20));
        c.touch("new");
        c.write("new", 1, 2, 3, &[3; 400]);
        assert_eq!(c.read("new", 1, 2, 3).unwrap(), vec![3; 400]);
        assert!(c.contains("old", 0, 0, 0));
        c.evict(&["new".to_string()]);
        assert!(!c.contains("old", 0, 0, 0), "oldest folder goes first");
        assert!(c.contains("mid", 0, 0, 0));
        assert!(c.contains("new", 1, 2, 3));
        assert_eq!(c.total_bytes(), 800);
        c.mark_level_done("new", 1);
        assert!(c.level_done("new", 1) && !c.level_done("new", 0));
        let c2 = DiskCache::new(root.clone(), 1000);
        c2.scan();
        assert_eq!(c2.total_bytes(), 800);
        let _ = std::fs::remove_dir_all(&root);
    }
}
