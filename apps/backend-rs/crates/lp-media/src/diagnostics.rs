//! `GET /api/media/diagnostics/{fname}` (admins): why the web server could
//! not read an original. Port of `MediaPermissionDiagnosticsView` and
//! `api/serving_permissions.py` (`diagnose_media_path`).

use axum::Json;
use axum::extract::{Path as UrlPath, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use lp_auth::AdminUser;
use lp_core::{ApiResult, AppState};
use lp_db::media::{self as q, PhotoKey};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::pyfmt::dirname;

const MOUNT_OPTION_FILESYSTEMS: &[&str] = &[
    "cifs",
    "smbfs",
    "smb3",
    "vfat",
    "msdos",
    "exfat",
    "ntfs",
    "ntfs3",
    "fuseblk",
    "iso9660",
    "udf",
    "sshfs",
    "fuse.sshfs",
];
const NETWORK_FILESYSTEMS: &[&str] = &[
    "nfs",
    "nfs4",
    "cifs",
    "smbfs",
    "smb3",
    "sshfs",
    "fuse.sshfs",
];

/// The uid/gid nginx serves originals as (`WEBSERVER_UID` / `WEBSERVER_GID`).
fn webserver_ids() -> (u32, u32) {
    let get = |k: &str| {
        std::env::var(k)
            .ok()
            .and_then(|v| v.trim().parse().ok())
            .unwrap_or(101)
    };
    (get("WEBSERVER_UID"), get("WEBSERVER_GID"))
}

/// What `os.stat` reports, as far as the diagnosis uses it.
struct Stat {
    mode: u32,
    uid: u32,
    gid: u32,
}

#[cfg(unix)]
fn stat(path: &str) -> std::io::Result<Stat> {
    use std::os::unix::fs::MetadataExt;
    let m = std::fs::metadata(path)?;
    Ok(Stat {
        mode: m.mode(),
        uid: m.uid(),
        gid: m.gid(),
    })
}

/// CPython's Windows `os.stat`: mode bits from the read-only attribute,
/// directories and `.exe/.bat/.cmd/.com` executable, uid/gid 0.
#[cfg(not(unix))]
fn stat(path: &str) -> std::io::Result<Stat> {
    let m = std::fs::metadata(path)?;
    let mut mode = if m.permissions().readonly() {
        0o444
    } else {
        0o666
    };
    if m.is_dir() {
        mode |= 0o040000 | 0o111;
    } else {
        mode |= 0o100000;
        let lower = path.to_lowercase();
        if [".exe", ".bat", ".cmd", ".com"]
            .iter()
            .any(|e| lower.ends_with(e))
        {
            mode |= 0o111;
        }
    }
    Ok(Stat {
        mode,
        uid: 0,
        gid: 0,
    })
}

/// `_permits`: owner class, else group class, else other; no fall-through.
fn permits(st: &Stat, uid: u32, gid: u32, user_bit: u32, group_bit: u32, other_bit: u32) -> bool {
    if st.uid == uid {
        st.mode & user_bit != 0
    } else if st.gid == gid {
        st.mode & group_bit != 0
    } else {
        st.mode & other_bit != 0
    }
}

/// `os.path.normpath`.
pub fn normpath(path: &str) -> String {
    if cfg!(windows) {
        normpath_nt(path)
    } else {
        normpath_posix(path)
    }
}

fn collapse(parts: &[&str], absolute: bool) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for &p in parts {
        match p {
            "" | "." => {}
            ".." => {
                if out.last().is_some_and(|l| l != "..") {
                    out.pop();
                } else if !absolute {
                    out.push("..".into());
                }
            }
            other => out.push(other.to_string()),
        }
    }
    out
}

fn normpath_posix(path: &str) -> String {
    if path.is_empty() {
        return ".".into();
    }
    let lead = if path.starts_with("//") && !path.starts_with("///") {
        "//"
    } else if path.starts_with('/') {
        "/"
    } else {
        ""
    };
    let parts: Vec<&str> = path.split('/').collect();
    let joined = collapse(&parts, !lead.is_empty()).join("/");
    let out = format!("{lead}{joined}");
    if out.is_empty() { ".".into() } else { out }
}

fn normpath_nt(path: &str) -> String {
    let p = path.replace('/', "\\");
    let (drive, rest) = if p.len() >= 2 && p.as_bytes()[1] == b':' {
        p.split_at(2)
    } else {
        ("", p.as_str())
    };
    let root = if rest.starts_with('\\') { "\\" } else { "" };
    let parts: Vec<&str> = rest.split('\\').collect();
    let joined = collapse(&parts, !root.is_empty()).join("\\");
    let out = format!("{drive}{root}{joined}");
    if out.is_empty() { ".".into() } else { out }
}

/// `_ancestors`: every directory above `path`, outermost first.
fn ancestors(path: &str) -> Vec<String> {
    let mut parent = dirname(&normpath(path)).to_string();
    let mut chain = Vec::new();
    loop {
        chain.push(parent.clone());
        let next = dirname(&parent).to_string();
        if next == parent || next.is_empty() {
            break;
        }
        parent = next;
    }
    chain.reverse();
    chain
}

fn unescape_mount_field(value: &str) -> String {
    value
        .replace("\\040", " ")
        .replace("\\011", "\t")
        .replace("\\012", "\n")
        .replace("\\134", "\\")
}

struct Mount {
    point: String,
    kind: String,
    options: Vec<String>,
}

fn read_mounts() -> Vec<Mount> {
    let Ok(text) = std::fs::read("/proc/mounts") else {
        return Vec::new();
    };
    String::from_utf8_lossy(&text)
        .lines()
        .filter_map(|line| {
            let f: Vec<&str> = line.split_whitespace().collect();
            (f.len() >= 4).then(|| Mount {
                point: unescape_mount_field(f[1]),
                kind: f[2].to_string(),
                options: f[3].split(',').map(str::to_string).collect(),
            })
        })
        .collect()
}

/// `describe_mount`: the mount entry with the longest matching point.
fn describe_mount(path: &str) -> Value {
    let path = normpath(path);
    let mut best: Option<Mount> = None;
    for m in read_mounts() {
        let point = normpath(&m.point);
        let inside = path == point
            || path.starts_with(&format!("{}/", point.trim_end_matches('/')))
            || point == "/";
        if inside
            && best
                .as_ref()
                .is_none_or(|b| point.len() > normpath(&b.point).len())
        {
            best = Some(m);
        }
    }
    let Some(best) = best else {
        return Value::Null;
    };
    json!({
        "point": best.point,
        "type": best.kind,
        "options": best.options,
        "read_only": best.options.iter().any(|o| o == "ro"),
        "permissions_from_mount": MOUNT_OPTION_FILESYSTEMS.contains(&best.kind.as_str()),
        "network": NETWORK_FILESYSTEMS.contains(&best.kind.as_str()),
    })
}

fn describe_component(path: &str, st: &Stat, kind: &str) -> Value {
    json!({
        "path": path,
        "kind": kind,
        "mode": format!("{:04o}", st.mode & 0o7777),
        "uid": st.uid,
        "gid": st.gid,
    })
}

/// `_remedies`.
fn remedies(cause: &str, blocking: &Value, mount: &Value, data_root: &str) -> Vec<&'static str> {
    if cause == "not_mode_bits" {
        return vec!["labels"];
    }
    if cause != "mode_bits" {
        return Vec::new();
    }
    let flag = |k: &str| mount.get(k).and_then(Value::as_bool).unwrap_or(false);
    let has_mount = !mount.is_null();
    let mut out = Vec::new();
    if let Some(bp) = blocking.get("path").and_then(Value::as_str) {
        let bp = normpath(bp);
        if bp == normpath(data_root) || bp == "/" {
            out.push("mount_deeper");
        }
    }
    if has_mount && flag("read_only") {
        out.push("read_only");
    }
    if has_mount && flag("permissions_from_mount") {
        out.push("mount_options");
    } else if has_mount && flag("network") {
        out.push("network_fs");
    } else {
        out.push("chmod");
    }
    if has_mount && flag("network") && !out.contains(&"network_fs") {
        out.push("network_fs");
    }
    out
}

/// `diagnose_media_path`.
pub fn diagnose_media_path(path: &str, data_root: &str) -> Value {
    const S_IXUSR: u32 = 0o100;
    const S_IXGRP: u32 = 0o010;
    const S_IXOTH: u32 = 0o001;
    const S_IRUSR: u32 = 0o400;
    const S_IRGRP: u32 = 0o040;
    const S_IROTH: u32 = 0o004;

    let (uid, gid) = webserver_ids();
    let path = normpath(path);
    let mount = describe_mount(&path);
    let result =
        |exists: bool, readable: bool, cause: &str, blocking: Value, remedies: Vec<&str>| {
            json!({
                "path": path,
                "exists": exists,
                "readable_by_webserver": readable,
                "cause": cause,
                "blocking": blocking,
                "webserver": {"uid": uid, "gid": gid},
                "mount": mount,
                "remedies": remedies,
            })
        };

    for directory in ancestors(&path) {
        match stat(&directory) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                let blocking = json!({"path": directory, "kind": "directory"});
                return result(false, false, "missing", blocking, Vec::new());
            }
            Err(_) => {
                let blocking = json!({"path": directory, "kind": "directory"});
                let r = remedies("not_mode_bits", &blocking, &mount, data_root);
                return result(true, false, "not_mode_bits", blocking, r);
            }
            Ok(st) => {
                if !permits(&st, uid, gid, S_IXUSR, S_IXGRP, S_IXOTH) {
                    let blocking = describe_component(&directory, &st, "directory");
                    let r = remedies("mode_bits", &blocking, &mount, data_root);
                    return result(true, false, "mode_bits", blocking, r);
                }
            }
        }
    }

    match stat(&path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let blocking = json!({"path": path, "kind": "file"});
            result(false, false, "missing", blocking, Vec::new())
        }
        Err(_) => {
            let blocking = json!({"path": path, "kind": "file"});
            let r = remedies("not_mode_bits", &blocking, &mount, data_root);
            result(true, false, "not_mode_bits", blocking, r)
        }
        Ok(st) => {
            if !permits(&st, uid, gid, S_IRUSR, S_IRGRP, S_IROTH) {
                let blocking = describe_component(&path, &st, "file");
                let r = remedies("mode_bits", &blocking, &mount, data_root);
                return result(true, false, "mode_bits", blocking, r);
            }
            let r = remedies("not_mode_bits", &Value::Null, &mount, data_root);
            result(true, true, "not_mode_bits", Value::Null, r)
        }
    }
}

/// `_get_photo_filter_kwargs`: a valid UUID addresses the pk, anything else the hash.
fn photo_key(value: &str) -> PhotoKey<'_> {
    if value.chars().count() == 36
        && value.matches('-').count() == 4
        && let Ok(id) = Uuid::parse_str(value)
    {
        return PhotoKey::Id(id);
    }
    PhotoKey::Hash(value)
}

pub async fn diagnostics(
    State(state): State<AppState>,
    _admin: AdminUser,
    UrlPath(fname): UrlPath<String>,
) -> ApiResult<Response> {
    let found = q::main_file_path(&state.db, photo_key(&fname)).await?;
    let Some(main) = found else {
        return Ok((
            StatusCode::NOT_FOUND,
            Json(json!({"detail": "No photo matches that identifier."})),
        )
            .into_response());
    };
    let Some(main) = main else {
        return Ok(Json(json!({
            "path": null,
            "exists": false,
            "readable_by_webserver": false,
            "cause": "missing",
            "blocking": null,
            "remedies": [],
        }))
        .into_response());
    };
    let data_root = state.config.photos.to_string_lossy().into_owned();
    let report = state
        .blocking(move || diagnose_media_path(&main, &data_root))
        .await?;
    Ok(Json(report).into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normpaths() {
        assert_eq!(normpath_posix("/data//a/./b/../c.jpg"), "/data/a/c.jpg");
        assert_eq!(normpath_posix("/.."), "/");
        assert_eq!(normpath_posix("a/../.."), "..");
        assert_eq!(normpath_nt("C:/x\\y/../z.jpg"), "C:\\x\\z.jpg");
        assert_eq!(normpath_nt("C:\\"), "C:\\");
    }

    #[test]
    fn permission_classes_do_not_fall_through() {
        let st = Stat {
            mode: 0o077,
            uid: 101,
            gid: 5,
        };
        assert!(!permits(&st, 101, 101, 0o400, 0o040, 0o004));
        let st = Stat {
            mode: 0o750,
            uid: 0,
            gid: 101,
        };
        assert!(permits(&st, 101, 101, 0o100, 0o010, 0o001));
        let st = Stat {
            mode: 0o750,
            uid: 0,
            gid: 0,
        };
        assert!(!permits(&st, 101, 101, 0o100, 0o010, 0o001));
    }

    #[test]
    fn remedy_order() {
        let blocking = json!({"path": "/data"});
        let cifs = json!({"read_only": true, "permissions_from_mount": true, "network": true});
        assert_eq!(
            remedies("mode_bits", &blocking, &cifs, "/data"),
            vec!["mount_deeper", "read_only", "mount_options", "network_fs"]
        );
        assert_eq!(
            remedies("mode_bits", &json!({"path": "/x"}), &Value::Null, "/data"),
            vec!["chmod"]
        );
        assert_eq!(
            remedies("not_mode_bits", &Value::Null, &Value::Null, "/data"),
            vec!["labels"]
        );
        assert!(remedies("missing", &Value::Null, &Value::Null, "/data").is_empty());
    }
}
