use std::cmp::Ordering;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::formats::{FileKind, kind_of};

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub modified_ms: i64,
    pub kind: FileKind,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FolderListing {
    pub folder: String,
    pub files: Vec<FileEntry>,
    pub index: usize,
}

pub fn modified_ms(meta: &std::fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn natural_cmp(a: &str, b: &str) -> Ordering {
    natord::compare_ignore_case(a, b).then_with(|| a.cmp(b))
}

pub fn list_folder(path: &str) -> Result<FolderListing, String> {
    let given = PathBuf::from(path);
    let meta = std::fs::metadata(&given).map_err(|e| format!("{path}: {e}"))?;
    let folder = if meta.is_dir() {
        given.clone()
    } else {
        given.parent().ok_or("no parent folder")?.to_path_buf()
    };
    let mut files = Vec::with_capacity(256);
    for entry in std::fs::read_dir(&folder).map_err(|e| e.to_string())? {
        let Ok(entry) = entry else { continue };
        let name = entry.file_name();
        let Some(kind) = kind_of(Path::new(&name)) else {
            continue;
        };
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        files.push(FileEntry {
            name: name.to_string_lossy().into_owned(),
            path: entry.path().to_string_lossy().into_owned(),
            size: meta.len(),
            modified_ms: modified_ms(&meta),
            kind,
        });
    }
    files.sort_unstable_by(|a, b| natural_cmp(&a.name, &b.name));
    let index = if meta.is_dir() {
        0
    } else {
        let wanted = given
            .file_name()
            .map(|n| n.to_string_lossy().to_lowercase());
        files
            .iter()
            .position(|f| Some(f.name.to_lowercase()) == wanted)
            .unwrap_or(0)
    };
    Ok(FolderListing {
        folder: folder.to_string_lossy().into_owned(),
        files,
        index,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn natural_sort_like_explorer() {
        let mut v = vec![
            "IMG_10.jpg",
            "img_2.jpg",
            "IMG_1.jpg",
            "IMG_100.jpg",
            "a.jpg",
            "B.jpg",
            "IMG_2.JPG",
            "photo 9.png",
            "photo 10.png",
        ];
        v.sort_by(|a, b| natural_cmp(a, b));
        assert_eq!(
            v,
            [
                "a.jpg",
                "B.jpg",
                "IMG_1.jpg",
                "IMG_2.JPG",
                "img_2.jpg",
                "IMG_10.jpg",
                "IMG_100.jpg",
                "photo 9.png",
                "photo 10.png"
            ]
        );
    }

    #[test]
    fn lists_and_filters_a_temp_folder() {
        let dir = std::env::temp_dir().join(format!("lpview-list-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        for n in [
            "IMG_10.jpg",
            "IMG_2.jpg",
            "notes.txt",
            "off",
            "clip.MP4",
            "x.cr3",
        ] {
            std::fs::write(dir.join(n), b"x").unwrap();
        }
        std::fs::create_dir_all(dir.join("sub.jpg")).unwrap();
        let l = list_folder(dir.join("IMG_10.jpg").to_str().unwrap()).unwrap();
        let names: Vec<_> = l.files.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, ["clip.MP4", "IMG_2.jpg", "IMG_10.jpg", "x.cr3"]);
        assert_eq!(l.index, 2);
        assert_eq!(l.files[0].kind, FileKind::Video);
        assert_eq!(l.files[3].kind, FileKind::Raw);
        let l = list_folder(dir.to_str().unwrap()).unwrap();
        assert_eq!(l.index, 0);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
