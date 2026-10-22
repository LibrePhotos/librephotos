//! The `os.path` behaviour the Django views rely on (`ntpath` on Windows,
//! `posixpath` elsewhere): scan directories are stored exactly as
//! `os.path.abspath` spells them, and containment is `api.util.is_valid_path`.

#[cfg(windows)]
pub const SEP: char = '\\';
#[cfg(not(windows))]
pub const SEP: char = '/';

fn is_sep(c: char) -> bool {
    c == '/' || (cfg!(windows) && c == '\\')
}

/// `ntpath.splitdrive` (drive letter or UNC share); empty on POSIX.
fn split_drive(p: &str) -> (&str, &str) {
    if !cfg!(windows) {
        return ("", p);
    }
    let b = p.as_bytes();
    if b.len() >= 2 && b[1] == b':' && b[0].is_ascii_alphabetic() {
        return p.split_at(2);
    }
    if b.len() >= 2 && is_sep(b[0] as char) && is_sep(b[1] as char) {
        // \\server\share
        let rest = &p[2..];
        if let Some(i) = rest.find(is_sep) {
            let after = &rest[i + 1..];
            let j = after.find(is_sep).map(|j| 2 + i + 1 + j).unwrap_or(p.len());
            if j > 2 + i + 1 {
                return p.split_at(j);
            }
        }
    }
    ("", p)
}

/// `os.path.isabs` (Python 3.11: on Windows a leading separator counts).
pub fn is_abs(p: &str) -> bool {
    if cfg!(windows) {
        let head: String = p
            .chars()
            .take(3)
            .map(|c| if c == '/' { '\\' } else { c })
            .collect();
        head.starts_with('\\') || head.get(1..).is_some_and(|h| h.starts_with(":\\"))
    } else {
        p.starts_with('/')
    }
}

/// `os.path.normpath`.
pub fn normpath(p: &str) -> String {
    let p: String = if cfg!(windows) {
        p.replace('/', "\\")
    } else {
        p.to_string()
    };
    let (drive, rest) = split_drive(&p);
    let rooted = rest.starts_with(SEP);
    let mut parts: Vec<&str> = Vec::new();
    for comp in rest.split(SEP) {
        match comp {
            "" | "." => {}
            ".." => {
                if parts.last().is_some_and(|l| *l != "..") {
                    parts.pop();
                } else if !rooted {
                    parts.push("..");
                }
            }
            c => parts.push(c),
        }
    }
    let mut out = String::from(drive);
    if rooted {
        out.push(SEP);
    }
    out.push_str(&parts.join(&SEP.to_string()));
    if out.is_empty() { ".".into() } else { out }
}

/// `os.path.abspath` (relative paths resolve against the process CWD).
pub fn abspath(p: &str) -> String {
    if is_abs(p) {
        normpath(p)
    } else {
        let cwd = std::env::current_dir()
            .map(|c| c.to_string_lossy().into_owned())
            .unwrap_or_default();
        normpath(&join(&cwd, p))
    }
}

/// `os.path.join(a, b)` for a relative `b`.
pub fn join(a: &str, b: &str) -> String {
    if is_abs(b) {
        return b.to_string();
    }
    if a.is_empty() || a.ends_with(is_sep) || (cfg!(windows) && a.ends_with(':')) {
        format!("{a}{b}")
    } else {
        format!("{a}{SEP}{b}")
    }
}

/// `os.path.normcase`.
pub fn normcase(p: &str) -> String {
    if cfg!(windows) {
        p.replace('/', "\\").to_lowercase()
    } else {
        p.to_string()
    }
}

/// `os.path.basename`.
pub fn basename(p: &str) -> &str {
    let (_, rest) = split_drive(p);
    match rest.rfind(is_sep) {
        Some(i) => &rest[i + 1..],
        None => rest,
    }
}

/// `os.path.dirname`.
pub fn dirname(p: &str) -> String {
    let (drive, rest) = split_drive(p);
    let head = match rest.rfind(is_sep) {
        Some(i) => &rest[..=i],
        None => "",
    };
    let trimmed = head.trim_end_matches(is_sep);
    let head = if trimmed.is_empty() { head } else { trimmed };
    format!("{drive}{head}")
}

/// `api.util.is_valid_path`: `path` is `root` or lies inside it.
pub fn is_valid_path(path: &str, root: &str) -> bool {
    let abs_path = normcase(&abspath(path));
    let abs_root = normcase(&abspath(root));
    if abs_path == abs_root {
        return true;
    }
    let prefix = if abs_root.ends_with(SEP) {
        abs_root
    } else {
        format!("{abs_root}{SEP}")
    };
    abs_path.starts_with(&prefix)
}

/// `os.path.realpath`: symlinks resolved as far as the path exists.
pub fn realpath(p: &str) -> String {
    let abs = abspath(p);
    let mut existing = std::path::PathBuf::from(&abs);
    let mut tail: Vec<std::ffi::OsString> = Vec::new();
    loop {
        if let Ok(c) = std::fs::canonicalize(&existing) {
            let mut out = c.to_string_lossy().into_owned();
            if let Some(stripped) = out.strip_prefix(r"\\?\UNC\") {
                out = format!(r"\\{stripped}");
            } else if let Some(stripped) = out.strip_prefix(r"\\?\") {
                out = stripped.to_string();
            }
            for t in tail.iter().rev() {
                out = join(&out, &t.to_string_lossy());
            }
            return out;
        }
        match (
            existing.file_name().map(|f| f.to_os_string()),
            existing.parent(),
        ) {
            (Some(name), Some(parent)) => {
                tail.push(name);
                existing = parent.to_path_buf();
            }
            _ => return abs,
        }
    }
}

/// `comparable_path`: `normcase(realpath(path))`.
pub fn comparable(p: &str) -> String {
    normcase(&realpath(p))
}

/// `directories_overlap`.
pub fn overlap(one: &str, other: &str) -> bool {
    let (a, b) = (comparable(one), comparable(other));
    is_valid_path(&a, &b) || is_valid_path(&b, &a)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn ntpath() {
        assert_eq!(normpath("C:/a/b/../c/"), r"C:\a\c");
        assert_eq!(abspath(r"C:\data\.\alice\"), r"C:\data\alice");
        assert!(is_valid_path(r"C:\Data\Alice", "c:/data"));
        assert!(!is_valid_path(r"C:\data2", r"C:\data"));
        assert!(!is_valid_path(r"C:\data\..\etc", r"C:\data"));
        assert_eq!(basename(r"C:\x\y"), "y");
        assert_eq!(basename("C:/x/y/"), "");
        assert_eq!(dirname(r"C:\data\alice"), r"C:\data");
        assert_eq!(join(r"C:\data", "alice"), r"C:\data\alice");
        assert_eq!(join("C:/data", "alice"), r"C:/data\alice");
    }

    #[cfg(not(windows))]
    #[test]
    fn posixpath() {
        assert_eq!(normpath("/a/b/../c/"), "/a/c");
        assert!(is_valid_path("/data/alice", "/data"));
        assert!(!is_valid_path("/data2", "/data"));
        assert_eq!(dirname("/data/alice"), "/data");
    }
}
