pub mod files;
pub mod watch;

use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};

use serde::Serialize;

use crate::formats::FileKind;
use files::{FileStat, file_stat, taken_ms, walk_each};

pub const WALK_BATCH: usize = 500;
pub const META_THREADS: usize = 4;
pub const MAX_PATHS: usize = 4096;

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    pub path: String,
    pub folder: String,
    pub name: String,
    pub size: i64,
    pub mtime_ms: i64,
    pub kind: FileKind,
}

impl From<FileStat> for FsEntry {
    fn from(s: FileStat) -> Self {
        FsEntry {
            path: s.path,
            folder: s.folder,
            name: s.name,
            size: s.size,
            mtime_ms: s.mtime,
            kind: s.kind,
        }
    }
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WalkBatch {
    pub files: Vec<FsEntry>,
    pub done: bool,
}

pub fn walk(
    root: &Path,
    batch: usize,
    mut send: impl FnMut(WalkBatch) -> bool,
) -> Result<usize, String> {
    let mut buf = Vec::with_capacity(batch);
    let mut total = 0;
    let mut open = true;
    walk_each(root, |s| {
        buf.push(FsEntry::from(s));
        total += 1;
        if buf.len() >= batch {
            open = send(WalkBatch {
                files: std::mem::replace(&mut buf, Vec::with_capacity(batch)),
                done: false,
            });
        }
        open
    })
    .map_err(|e| format!("{}: {e}", root.display()))?;
    if open {
        send(WalkBatch {
            files: buf,
            done: true,
        });
    }
    Ok(total)
}

pub fn stat(path: &str) -> Option<FsEntry> {
    let p = Path::new(path);
    let meta = std::fs::metadata(p).ok()?;
    file_stat(p, &meta).map(FsEntry::from)
}

#[derive(Serialize, Debug, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct FileMeta {
    pub path: String,
    pub format: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub taken_at: Option<String>,
    pub taken_ms: Option<i64>,
    pub camera_make: Option<String>,
    pub camera_model: Option<String>,
    pub camera: Option<String>,
    pub lens: Option<String>,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub rating: Option<u8>,
    pub caption: Option<String>,
    pub keywords: Vec<String>,
}

fn camera_label(make: Option<&str>, model: Option<&str>) -> Option<String> {
    match (make, model) {
        (Some(make), Some(model)) if model.to_lowercase().starts_with(&make.to_lowercase()) => {
            Some(model.to_string())
        }
        (Some(make), Some(model)) => Some(format!("{make} {model}")),
        (a, b) => a.or(b).map(str::to_string),
    }
}

pub fn file_meta(path: &str) -> Option<FileMeta> {
    let info = crate::info::image_info(path).ok()?;
    Some(FileMeta {
        path: path.to_string(),
        camera: camera_label(info.camera_make.as_deref(), info.camera_model.as_deref()),
        format: info.format,
        width: info.width,
        height: info.height,
        taken_ms: info.taken_at.as_deref().and_then(taken_ms),
        taken_at: info.taken_at,
        camera_make: info.camera_make,
        camera_model: info.camera_model,
        lens: info.lens,
        lat: info.gps.map(|g| g.lat),
        lon: info.gps.map(|g| g.lon),
        rating: info.rating,
        caption: info.caption,
        keywords: info.keywords,
    })
}

pub fn read_metadata(paths: &[String]) -> Vec<Option<FileMeta>> {
    let next = AtomicUsize::new(0);
    let mut out: Vec<Option<FileMeta>> = vec![None; paths.len()];
    std::thread::scope(|s| {
        let workers: Vec<_> = (0..META_THREADS.min(paths.len()))
            .map(|_| {
                s.spawn(|| {
                    let mut mine = Vec::new();
                    loop {
                        let i = next.fetch_add(1, Ordering::Relaxed);
                        let Some(path) = paths.get(i) else { break };
                        mine.push((i, file_meta(path)));
                    }
                    mine
                })
            })
            .collect();
        for w in workers {
            for (i, m) in w.join().unwrap_or_default() {
                out[i] = m;
            }
        }
    });
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    pub(crate) fn temp_dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("lpview-seam-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn walks_in_batches() {
        let dir = temp_dir("walk");
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::create_dir_all(dir.join(".hidden")).unwrap();
        for i in 0..7 {
            std::fs::write(dir.join("sub").join(format!("{i}.jpg")), b"x").unwrap();
        }
        std::fs::write(dir.join("notes.txt"), b"x").unwrap();
        std::fs::write(dir.join(".hidden").join("h.jpg"), b"x").unwrap();
        std::fs::write(dir.join("clip.MP4"), b"xyz").unwrap();
        let mut batches = Vec::new();
        let n = walk(&dir, 3, |b| {
            batches.push(b);
            true
        })
        .unwrap();
        assert_eq!(n, 8);
        let sizes: Vec<_> = batches.iter().map(|b| (b.files.len(), b.done)).collect();
        assert_eq!(sizes, [(3, false), (3, false), (2, true)]);
        let clip = batches
            .iter()
            .flat_map(|b| &b.files)
            .find(|f| f.name == "clip.MP4")
            .unwrap();
        assert_eq!(clip.kind, FileKind::Video);
        assert_eq!(clip.size, 3);
        assert_eq!(clip.folder, dir.to_string_lossy());
        let json = serde_json::to_value(clip).unwrap();
        let keys: Vec<_> = json.as_object().unwrap().keys().cloned().collect();
        assert_eq!(keys, ["folder", "kind", "mtimeMs", "name", "path", "size"]);
        assert_eq!(json["kind"], "video");

        let mut calls = 0;
        walk(&dir, 3, |_| {
            calls += 1;
            false
        })
        .unwrap();
        assert_eq!(calls, 1);
        assert!(walk(&dir.join("missing"), 3, |_| true).is_err());

        assert_eq!(
            stat(clip.path.as_str()).map(|e| e.size),
            Some(3),
            "stat agrees with the walk"
        );
        assert_eq!(stat(dir.join("notes.txt").to_str().unwrap()), None);
        assert_eq!(stat(dir.to_str().unwrap()), None);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn reads_metadata_in_order() {
        let corpus = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../../desktop-test-corpus/testfiles/protected");
        let mut paths: Vec<String> = std::fs::read_dir(&corpus)
            .map(|d| {
                d.flatten()
                    .map(|e| e.path())
                    .filter(|p| p.to_string_lossy().ends_with("-unsplash.jpg"))
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect()
            })
            .unwrap_or_default();
        paths.sort();
        paths.truncate(6);
        paths.insert(0, "C:/does/not/exist.jpg".into());
        let metas = read_metadata(&paths);
        assert_eq!(metas.len(), paths.len());
        assert_eq!(metas[0], None);
        for (p, m) in paths.iter().zip(&metas).skip(1) {
            let m = m.as_ref().expect("a corpus JPEG has metadata");
            assert_eq!(&m.path, p);
            assert_eq!(m.format, "JPEG");
            assert!(m.width.is_some() && m.height.is_some());
            assert_eq!(m.taken_ms, m.taken_at.as_deref().and_then(taken_ms));
        }
        assert!(read_metadata(&[]).is_empty());
    }

    #[test]
    fn camera_labels() {
        assert_eq!(
            camera_label(Some("Canon"), Some("Canon EOS R5")).as_deref(),
            Some("Canon EOS R5")
        );
        assert_eq!(
            camera_label(Some("SONY"), Some("ILCE-7M3")).as_deref(),
            Some("SONY ILCE-7M3")
        );
        assert_eq!(camera_label(None, Some("X")).as_deref(), Some("X"));
        assert_eq!(camera_label(None, None), None);
    }
}
