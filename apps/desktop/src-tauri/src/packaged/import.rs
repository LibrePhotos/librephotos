use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;
use serde::Serialize;

use crate::localdb;

pub const MARKER: &str = "imported-from-installer-build.json";
pub const SETTINGS: &str = "settings.json";
const STAGING_SUFFIX: &str = ".importing";

fn unix_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
}

#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    HasData,
    NothingToImport,
    Imported(Vec<String>),
    Failed(String),
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Marker<'a> {
    from: String,
    files: &'a [&'a str],
    imported_at_ms: i64,
}

pub fn has_data(root: &Path) -> bool {
    [MARKER, SETTINGS, localdb::FILE_NAME]
        .iter()
        .any(|name| root.join(name).exists())
}

pub fn staging_dir(root: &Path) -> PathBuf {
    let mut name = root.file_name().unwrap_or_default().to_os_string();
    name.push(STAGING_SUFFIX);
    root.with_file_name(name)
}

pub fn import_once(legacy: &Path, root: &Path) -> Outcome {
    if has_data(root) {
        return Outcome::HasData;
    }
    let files: Vec<&str> = [SETTINGS, localdb::FILE_NAME]
        .into_iter()
        .filter(|name| legacy.join(name).is_file())
        .collect();
    if files.is_empty() {
        return Outcome::NothingToImport;
    }
    let staging = staging_dir(root);
    match stage(legacy, &staging, &files).and_then(|()| publish(&staging, root, &files)) {
        Ok(()) => Outcome::Imported(files.iter().map(|f| f.to_string()).collect()),
        Err(e) => {
            let _ = remove_dir(&staging);
            Outcome::Failed(e)
        }
    }
}

fn remove_dir(dir: &Path) -> io::Result<()> {
    match fs::remove_dir_all(dir) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        other => other,
    }
}

fn stage(legacy: &Path, staging: &Path, files: &[&str]) -> Result<(), String> {
    let at = |what: &str, e: &dyn std::fmt::Display| format!("{what}: {e}");
    remove_dir(staging).map_err(|e| at("clearing an earlier import", &e))?;
    fs::create_dir_all(staging).map_err(|e| at("creating the import folder", &e))?;
    for name in files {
        fs::copy(legacy.join(name), staging.join(name)).map_err(|e| at(name, &e))?;
    }
    if files.contains(&localdb::FILE_NAME) {
        let wal = format!("{}-wal", localdb::FILE_NAME);
        if legacy.join(&wal).is_file() {
            fs::copy(legacy.join(&wal), staging.join(&wal)).map_err(|e| at(&wal, &e))?;
        }
        settle_database(&staging.join(localdb::FILE_NAME))?;
    }
    let marker = Marker {
        from: legacy.display().to_string(),
        files,
        imported_at_ms: unix_millis(),
    };
    let json = serde_json::to_vec_pretty(&marker).map_err(|e| at(MARKER, &e))?;
    fs::write(staging.join(MARKER), json).map_err(|e| at(MARKER, &e))
}

fn settle_database(path: &Path) -> Result<(), String> {
    let conn = Connection::open(path).map_err(|e| format!("opening the copied library: {e}"))?;
    let check: String = conn
        .query_row("PRAGMA quick_check", [], |row| row.get(0))
        .map_err(|e| format!("checking the copied library: {e}"))?;
    if check != "ok" {
        return Err(format!("the copied library is damaged: {check}"));
    }
    conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()))
        .map_err(|e| format!("checkpointing the copied library: {e}"))?;
    conn.close()
        .map_err(|(_, e)| format!("closing the copied library: {e}"))?;
    for suffix in ["-wal", "-shm"] {
        let side = PathBuf::from(format!("{}{suffix}", path.display()));
        if side.exists() {
            fs::remove_file(&side).map_err(|e| format!("{}: {e}", side.display()))?;
        }
    }
    Ok(())
}

fn publish(staging: &Path, root: &Path, files: &[&str]) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|e| format!("creating {}: {e}", root.display()))?;
    for name in files.iter().chain([&MARKER]) {
        fs::rename(staging.join(name), root.join(name)).map_err(|e| format!("{name}: {e}"))?;
    }
    remove_dir(staging).map_err(|e| format!("removing the import folder: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Scratch(PathBuf);

    impl Scratch {
        fn new(name: &str) -> Scratch {
            let dir = std::env::temp_dir().join(format!(
                "lpview-import-{name}-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos()
            ));
            fs::create_dir_all(&dir).unwrap();
            Scratch(dir)
        }

        fn legacy(&self) -> PathBuf {
            self.0.join("real").join("com.librephotos.viewer")
        }

        fn root(&self) -> PathBuf {
            self.0.join("package").join("com.librephotos.viewer")
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn library_with_rows(dir: &Path, rows: i64) -> Connection {
        fs::create_dir_all(dir).unwrap();
        let conn = Connection::open(dir.join(localdb::FILE_NAME)).unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.pragma_update(None, "wal_autocheckpoint", 0).unwrap();
        conn.execute_batch("CREATE TABLE picked (n INTEGER)")
            .unwrap();
        for n in 0..rows {
            conn.execute("INSERT INTO picked VALUES (?1)", [n]).unwrap();
        }
        conn
    }

    fn rows_in(dir: &Path) -> i64 {
        Connection::open(dir.join(localdb::FILE_NAME))
            .unwrap()
            .query_row("SELECT count(*) FROM picked", [], |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn starts_fresh_when_there_is_nothing_to_import() {
        let s = Scratch::new("fresh");
        assert_eq!(
            import_once(&s.legacy(), &s.root()),
            Outcome::NothingToImport
        );
        assert!(!s.root().exists());
    }

    #[test]
    fn copies_the_library_and_settings_once_with_a_marker() {
        let s = Scratch::new("copy");
        drop(library_with_rows(&s.legacy(), 3));
        fs::write(
            s.legacy().join(SETTINGS),
            br#"{"server":"https://photos.example"}"#,
        )
        .unwrap();
        fs::create_dir_all(s.legacy().join("cache")).unwrap();
        fs::write(s.legacy().join("cache").join("x.lpc"), b"cached").unwrap();

        assert_eq!(
            import_once(&s.legacy(), &s.root()),
            Outcome::Imported(vec![SETTINGS.into(), localdb::FILE_NAME.into()])
        );
        assert_eq!(rows_in(&s.root()), 3);
        assert_eq!(
            fs::read(s.root().join(SETTINGS)).unwrap(),
            br#"{"server":"https://photos.example"}"#
        );
        let marker: serde_json::Value =
            serde_json::from_slice(&fs::read(s.root().join(MARKER)).unwrap()).unwrap();
        assert_eq!(
            marker["files"],
            serde_json::json!([SETTINGS, localdb::FILE_NAME])
        );
        assert!(
            !s.root().join("cache").exists(),
            "caches are rebuilt, not copied"
        );
        assert!(!staging_dir(&s.root()).exists());
        assert_eq!(
            rows_in(&s.legacy()),
            3,
            "the installer build keeps its library"
        );

        let legacy = Connection::open(s.legacy().join(localdb::FILE_NAME)).unwrap();
        legacy
            .execute("INSERT INTO picked VALUES (99)", [])
            .unwrap();
        assert_eq!(import_once(&s.legacy(), &s.root()), Outcome::HasData);
        assert_eq!(rows_in(&s.root()), 3, "a second start never imports again");
    }

    #[test]
    fn brings_rows_still_waiting_in_the_write_ahead_log() {
        let s = Scratch::new("wal");
        let open = library_with_rows(&s.legacy(), 5);
        assert!(
            s.legacy()
                .join(format!("{}-wal", localdb::FILE_NAME))
                .exists(),
            "the rows are only in the write-ahead log"
        );
        assert_eq!(
            import_once(&s.legacy(), &s.root()),
            Outcome::Imported(vec![localdb::FILE_NAME.into()])
        );
        drop(open);
        assert_eq!(rows_in(&s.root()), 5);
        assert!(
            !s.root()
                .join(format!("{}-wal", localdb::FILE_NAME))
                .exists()
        );
    }

    #[test]
    fn never_mixes_into_a_packaged_library_that_already_exists() {
        let s = Scratch::new("exists");
        drop(library_with_rows(&s.legacy(), 4));
        drop(library_with_rows(&s.root(), 1));
        assert_eq!(import_once(&s.legacy(), &s.root()), Outcome::HasData);
        assert_eq!(rows_in(&s.root()), 1);
        assert!(!s.root().join(MARKER).exists());
    }

    #[test]
    fn imports_into_a_folder_that_holds_only_caches() {
        let s = Scratch::new("caches");
        drop(library_with_rows(&s.legacy(), 2));
        fs::create_dir_all(s.root().join("EBWebView")).unwrap();
        assert_eq!(
            import_once(&s.legacy(), &s.root()),
            Outcome::Imported(vec![localdb::FILE_NAME.into()])
        );
        assert_eq!(rows_in(&s.root()), 2);
        assert!(s.root().join("EBWebView").is_dir());
    }

    #[test]
    fn retries_after_an_import_that_stopped_half_way() {
        let s = Scratch::new("retry");
        drop(library_with_rows(&s.legacy(), 2));
        let staging = staging_dir(&s.root());
        fs::create_dir_all(&staging).unwrap();
        fs::write(staging.join(localdb::FILE_NAME), b"torn").unwrap();
        assert_eq!(
            import_once(&s.legacy(), &s.root()),
            Outcome::Imported(vec![localdb::FILE_NAME.into()])
        );
        assert_eq!(rows_in(&s.root()), 2);
        assert!(!staging.exists());
    }

    #[test]
    fn leaves_nothing_behind_when_the_library_is_damaged() {
        let s = Scratch::new("damaged");
        fs::create_dir_all(s.legacy()).unwrap();
        fs::write(s.legacy().join(localdb::FILE_NAME), vec![7u8; 8192]).unwrap();
        fs::write(s.legacy().join(SETTINGS), b"{}").unwrap();
        assert!(matches!(
            import_once(&s.legacy(), &s.root()),
            Outcome::Failed(_)
        ));
        assert!(!has_data(&s.root()));
        assert!(!staging_dir(&s.root()).exists());
    }

    #[test]
    fn stages_next_to_the_packaged_folder() {
        assert_eq!(
            staging_dir(Path::new(r"C:\p\LocalCache\Local\com.librephotos.viewer")),
            Path::new(r"C:\p\LocalCache\Local\com.librephotos.viewer.importing")
        );
    }
}
