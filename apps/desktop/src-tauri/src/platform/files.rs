use std::path::{MAIN_SEPARATOR, Path};

use chrono::NaiveDateTime;

use crate::formats::{FileKind, kind_of};
use crate::listing::modified_ms;

#[derive(Debug, Clone, PartialEq)]
pub struct FileStat {
    pub path: String,
    pub folder: String,
    pub name: String,
    pub size: i64,
    pub mtime: i64,
    pub kind: FileKind,
}

pub fn normalize_dir(p: &str) -> String {
    let p = if cfg!(windows) {
        p.replace('/', "\\")
    } else {
        p.to_string()
    };
    let trimmed = p.trim_end_matches(['\\', '/']);
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

pub fn skip_dir(name: &str) -> bool {
    name.starts_with('.')
        || name.eq_ignore_ascii_case("$RECYCLE.BIN")
        || name.eq_ignore_ascii_case("System Volume Information")
        || name == "@eaDir"
}

pub fn walk_each(dir: &Path, mut f: impl FnMut(FileStat) -> bool) -> std::io::Result<()> {
    let mut stack = vec![dir.to_path_buf()];
    let mut first = true;
    while let Some(d) = stack.pop() {
        let entries = match std::fs::read_dir(&d) {
            Ok(e) => e,
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
                && !f(s)
            {
                return Ok(());
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
