use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde::{Deserialize, Serialize};

pub const FILE_NAME: &str = "folder-access.json";

#[derive(Debug, PartialEq, Eq)]
pub struct Resumed {
    pub folder: String,
    pub stale: bool,
}

pub trait Scope: Send + Sync {
    fn create(&self, folder: &str) -> Result<Vec<u8>, String>;
    fn resume(&self, bookmark: &[u8]) -> Result<Resumed, String>;
}

#[derive(Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
struct Saved {
    folders: BTreeMap<String, String>,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Restored {
    pub folders: Vec<String>,
    pub dropped: Vec<String>,
}

pub struct FolderAccess {
    file: Option<PathBuf>,
    scope: Option<Box<dyn Scope>>,
    grants: Mutex<BTreeMap<String, String>>,
}

fn load(file: &Path) -> BTreeMap<String, String> {
    std::fs::read(file)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Saved>(&bytes).ok())
        .map(|saved| saved.folders)
        .unwrap_or_default()
}

fn save(file: &Path, folders: &BTreeMap<String, String>) -> Result<(), String> {
    let saved = Saved {
        folders: folders.clone(),
    };
    let json = serde_json::to_vec_pretty(&saved).map_err(|e| e.to_string())?;
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    let staged = file.with_extension("json.tmp");
    std::fs::write(&staged, json).map_err(|e| format!("{}: {e}", staged.display()))?;
    std::fs::rename(&staged, file).map_err(|e| format!("{}: {e}", file.display()))
}

impl FolderAccess {
    pub fn disabled() -> FolderAccess {
        FolderAccess {
            file: None,
            scope: None,
            grants: Mutex::new(BTreeMap::new()),
        }
    }

    pub fn restore(file: PathBuf, scope: Box<dyn Scope>) -> (FolderAccess, Restored) {
        let mut restored = Restored::default();
        let mut grants = BTreeMap::new();
        let mut changed = false;
        for (folder, encoded) in load(&file) {
            let resumed = STANDARD
                .decode(&encoded)
                .map_err(|e| e.to_string())
                .and_then(|bookmark| scope.resume(&bookmark));
            match resumed {
                Ok(r) if r.stale || r.folder != folder => {
                    changed = true;
                    match scope.create(&r.folder) {
                        Ok(fresh) => {
                            grants.insert(r.folder.clone(), STANDARD.encode(fresh));
                        }
                        Err(_) => {
                            grants.insert(r.folder.clone(), encoded);
                        }
                    }
                    restored.folders.push(r.folder);
                }
                Ok(r) => {
                    grants.insert(r.folder.clone(), encoded);
                    restored.folders.push(r.folder);
                }
                Err(_) => {
                    changed = true;
                    restored.dropped.push(folder);
                }
            }
        }
        if changed {
            let _ = save(&file, &grants);
        }
        let access = FolderAccess {
            file: Some(file),
            scope: Some(scope),
            grants: Mutex::new(grants),
        };
        (access, restored)
    }

    pub fn remember(&self, folder: &str) -> Result<bool, String> {
        let (Some(file), Some(scope)) = (&self.file, &self.scope) else {
            return Ok(false);
        };
        let bookmark = scope.create(folder)?;
        let mut grants = self.grants.lock().unwrap();
        grants.insert(folder.to_string(), STANDARD.encode(bookmark));
        save(file, &grants)?;
        Ok(true)
    }

    pub fn folders(&self) -> Vec<String> {
        self.grants.lock().unwrap().keys().cloned().collect()
    }
}

pub fn sandboxed() -> bool {
    std::env::var_os("APP_SANDBOX_CONTAINER_ID").is_some_and(|v| !v.is_empty())
}

#[cfg(target_os = "macos")]
pub fn system_scope() -> Option<Box<dyn Scope>> {
    sandboxed().then(|| Box::new(bookmarks::SecurityScoped) as Box<dyn Scope>)
}

#[cfg(not(target_os = "macos"))]
pub fn system_scope() -> Option<Box<dyn Scope>> {
    None
}

pub fn open(data_dir: Option<PathBuf>) -> (FolderAccess, Restored) {
    match (data_dir, system_scope()) {
        (Some(dir), Some(scope)) => FolderAccess::restore(dir.join(FILE_NAME), scope),
        _ => (FolderAccess::disabled(), Restored::default()),
    }
}

#[cfg(target_os = "macos")]
mod bookmarks {
    use objc2::rc::autoreleasepool;
    use objc2::runtime::Bool;
    use objc2_foundation::{
        NSData, NSString, NSURL, NSURLBookmarkCreationOptions, NSURLBookmarkResolutionOptions,
    };

    use super::{Resumed, Scope};

    pub struct SecurityScoped;

    impl Scope for SecurityScoped {
        fn create(&self, folder: &str) -> Result<Vec<u8>, String> {
            autoreleasepool(|_| {
                let url = NSURL::fileURLWithPath_isDirectory(&NSString::from_str(folder), true);
                url.bookmarkDataWithOptions_includingResourceValuesForKeys_relativeToURL_error(
                    NSURLBookmarkCreationOptions::WithSecurityScope,
                    None,
                    None,
                )
                .map(|data| data.to_vec())
                .map_err(|e| e.localizedDescription().to_string())
            })
        }

        fn resume(&self, bookmark: &[u8]) -> Result<Resumed, String> {
            autoreleasepool(|_| {
                let data = NSData::with_bytes(bookmark);
                let mut stale = Bool::NO;
                let url = unsafe {
                    NSURL::URLByResolvingBookmarkData_options_relativeToURL_bookmarkDataIsStale_error(
                        &data,
                        NSURLBookmarkResolutionOptions::WithSecurityScope,
                        None,
                        &mut stale,
                    )
                }
                .map_err(|e| e.localizedDescription().to_string())?;
                if !unsafe { url.startAccessingSecurityScopedResource() } {
                    return Err("macOS refused access to the folder".into());
                }
                let folder = url.path().ok_or("the bookmark has no path")?.to_string();
                Ok(Resumed {
                    folder,
                    stale: stale.as_bool(),
                })
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[derive(Default)]
    struct Fake {
        gone: Vec<String>,
        moved: Vec<(String, String)>,
        stale: Vec<String>,
        resumed: Arc<Mutex<Vec<String>>>,
    }

    impl Scope for Fake {
        fn create(&self, folder: &str) -> Result<Vec<u8>, String> {
            Ok(format!("bm:{folder}").into_bytes())
        }

        fn resume(&self, bookmark: &[u8]) -> Result<Resumed, String> {
            let text = String::from_utf8(bookmark.to_vec()).unwrap();
            let folder = text
                .strip_prefix("bm:")
                .ok_or("not a bookmark")?
                .to_string();
            if self.gone.contains(&folder) {
                return Err("gone".into());
            }
            self.resumed.lock().unwrap().push(folder.clone());
            let now = self
                .moved
                .iter()
                .find(|(from, _)| *from == folder)
                .map_or(folder.clone(), |(_, to)| to.clone());
            Ok(Resumed {
                stale: self.stale.contains(&folder),
                folder: now,
            })
        }
    }

    struct Scratch(PathBuf);

    impl Scratch {
        fn new(tag: &str) -> Scratch {
            let dir = std::env::temp_dir().join(format!(
                "lpview-access-{tag}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos()
            ));
            std::fs::create_dir_all(&dir).unwrap();
            Scratch(dir)
        }

        fn file(&self) -> PathBuf {
            self.0.join("data").join(FILE_NAME)
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn saved(file: &Path) -> serde_json::Value {
        serde_json::from_slice(&std::fs::read(file).unwrap()).unwrap()
    }

    #[test]
    fn remembers_a_folder_and_resumes_it_on_the_next_start() {
        let s = Scratch::new("remember");
        let (access, restored) = FolderAccess::restore(s.file(), Box::new(Fake::default()));
        assert_eq!(restored, Restored::default());
        assert_eq!(access.remember("/Users/u/Photos/2024"), Ok(true));
        assert_eq!(access.remember("/Volumes/Card/DCIM"), Ok(true));
        assert_eq!(
            saved(&s.file())["folders"]["/Users/u/Photos/2024"],
            STANDARD.encode("bm:/Users/u/Photos/2024")
        );

        let fake = Fake::default();
        let resumed = fake.resumed.clone();
        let (access, restored) = FolderAccess::restore(s.file(), Box::new(fake));
        assert_eq!(
            restored.folders,
            ["/Users/u/Photos/2024", "/Volumes/Card/DCIM"]
        );
        assert!(restored.dropped.is_empty());
        assert_eq!(
            *resumed.lock().unwrap(),
            ["/Users/u/Photos/2024", "/Volumes/Card/DCIM"]
        );
        assert_eq!(
            access.folders(),
            ["/Users/u/Photos/2024", "/Volumes/Card/DCIM"]
        );
    }

    #[test]
    fn drops_folders_that_are_gone_and_refreshes_stale_or_moved_ones() {
        let s = Scratch::new("stale");
        let (access, _) = FolderAccess::restore(s.file(), Box::new(Fake::default()));
        for folder in ["/a", "/b", "/c"] {
            access.remember(folder).unwrap();
        }
        let fake = Fake {
            gone: vec!["/a".into()],
            moved: vec![("/b".into(), "/b2".into())],
            stale: vec!["/c".into()],
            ..Fake::default()
        };
        let (access, restored) = FolderAccess::restore(s.file(), Box::new(fake));
        assert_eq!(restored.dropped, ["/a"]);
        assert_eq!(restored.folders, ["/b2", "/c"]);
        assert_eq!(access.folders(), ["/b2", "/c"]);
        let json = saved(&s.file());
        let keys: Vec<_> = json["folders"]
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect();
        assert_eq!(keys, ["/b2", "/c"]);
        assert_eq!(json["folders"]["/b2"], STANDARD.encode("bm:/b2"));
    }

    #[test]
    fn a_damaged_file_starts_empty() {
        let s = Scratch::new("damaged");
        std::fs::create_dir_all(s.file().parent().unwrap()).unwrap();
        std::fs::write(s.file(), b"{not json").unwrap();
        let (access, restored) = FolderAccess::restore(s.file(), Box::new(Fake::default()));
        assert_eq!(restored, Restored::default());
        assert!(access.folders().is_empty());
    }

    #[test]
    fn outside_the_sandbox_nothing_is_remembered() {
        let access = FolderAccess::disabled();
        assert_eq!(access.remember("/anything"), Ok(false));
        assert!(access.folders().is_empty());
        let (access, restored) = open(Some(std::env::temp_dir()));
        assert_eq!(restored, Restored::default());
        assert_eq!(access.remember("/anything"), Ok(false));
        assert!(!sandboxed());
    }
}
