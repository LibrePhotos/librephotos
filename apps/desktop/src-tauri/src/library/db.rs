//! The library database (SQLite, WAL): roots, files with their metadata, MD5 and server state,
//! and an FTS5 index of search words per file.
//!
//! A file row with `root_id` NULL is a "loose" file: a picture opened in the viewer from outside
//! the library that the user asked to upload (or whose server state the info panel looked up).
//! Loose files never show in the library views; they only share the hash cache and upload queue.

use std::collections::HashMap;
use std::path::Path;

use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::Serialize;

use crate::formats::FileKind;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS roots (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  added_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY,
  root_id INTEGER REFERENCES roots(id) ON DELETE CASCADE,
  path TEXT NOT NULL UNIQUE,
  folder TEXT NOT NULL,
  name TEXT NOT NULL,
  size INTEGER NOT NULL,
  mtime INTEGER NOT NULL,
  kind TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  taken_at TEXT,
  sort_ms INTEGER NOT NULL,
  camera TEXT,
  lens TEXT,
  lat REAL,
  lon REAL,
  format TEXT,
  meta_done INTEGER NOT NULL DEFAULT 0,
  md5 TEXT,
  remote_state TEXT NOT NULL DEFAULT 'unknown',
  remote_id TEXT,
  remote_error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_try_ms INTEGER NOT NULL DEFAULT 0,
  upload_id TEXT,
  upload_offset INTEGER NOT NULL DEFAULT 0,
  upload_wanted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS files_root_sort ON files(root_id, sort_ms DESC);
CREATE INDEX IF NOT EXISTS files_md5 ON files(md5);
CREATE INDEX IF NOT EXISTS files_remote ON files(remote_state);
CREATE INDEX IF NOT EXISTS files_meta ON files(meta_done);
CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(terms, tokenize = 'unicode61 remove_diacritics 2');
"#;

/// Server state of a file (see CONTRACT.md "Library").
pub mod remote {
    /// Not hashed or not asked yet.
    pub const UNKNOWN: &str = "unknown";
    /// Claimed by the checker (hash + exists) right now.
    pub const CHECKING: &str = "checking";
    /// The server has it (`remote_id` is the photo id).
    pub const PRESENT: &str = "present";
    /// The server does not have it.
    pub const ABSENT: &str = "absent";
    pub const UPLOADING: &str = "uploading";
    /// The last upload failed; retried at `next_try_ms` until `MAX_ATTEMPTS`.
    pub const FAILED: &str = "failed";
}

/// Upload attempts before a file is left alone (until the user retries).
pub const MAX_ATTEMPTS: i64 = 6;

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    init(Connection::open(path)?)
}

pub fn open_memory() -> rusqlite::Result<Connection> {
    init(Connection::open_in_memory()?)
}

fn init(conn: Connection) -> rusqlite::Result<Connection> {
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    conn.execute_batch(SCHEMA)?;
    // Work a previous run was doing when it stopped starts over.
    conn.execute(
        "UPDATE files SET remote_state = 'unknown' WHERE remote_state = 'checking'",
        [],
    )?;
    conn.execute(
        "UPDATE files SET remote_state = 'absent' WHERE remote_state = 'uploading'",
        [],
    )?;
    Ok(conn)
}

pub fn kind_str(k: FileKind) -> &'static str {
    match k {
        FileKind::Image => "image",
        FileKind::Raw => "raw",
        FileKind::Video => "video",
    }
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Root {
    pub id: i64,
    pub path: String,
    pub file_count: i64,
}

/// A file as the UI sees it: a `FileEntry` plus library facts.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryFile {
    pub id: i64,
    pub path: String,
    pub name: String,
    pub size: i64,
    pub modified_ms: i64,
    pub kind: String,
    pub width: Option<i64>,
    pub height: Option<i64>,
    /// Date taken (or modified) as local wall-clock milliseconds (read with UTC getters).
    pub taken_ms: i64,
    /// Whether `taken_ms` comes from the picture's own metadata.
    pub dated: bool,
    pub root_id: Option<i64>,
    pub remote: String,
    pub remote_id: Option<String>,
    pub md5: Option<String>,
}

const FILE_COLS: &str = "id, path, name, size, mtime, kind, width, height, sort_ms, \
    taken_at IS NOT NULL, root_id, remote_state, remote_id, md5";

fn file_row(r: &rusqlite::Row) -> rusqlite::Result<LibraryFile> {
    Ok(LibraryFile {
        id: r.get(0)?,
        path: r.get(1)?,
        name: r.get(2)?,
        size: r.get(3)?,
        modified_ms: r.get(4)?,
        kind: r.get(5)?,
        width: r.get(6)?,
        height: r.get(7)?,
        taken_ms: r.get(8)?,
        dated: r.get(9)?,
        root_id: r.get(10)?,
        remote: r.get(11)?,
        remote_id: r.get(12)?,
        md5: r.get(13)?,
    })
}

/// What a directory walk knows about a file.
#[derive(Debug, Clone)]
pub struct FileStat {
    pub path: String,
    pub folder: String,
    pub name: String,
    pub size: i64,
    pub mtime: i64,
    pub kind: FileKind,
}

/// What survives a rename: the content's hash and what the server knows about it.
#[derive(Debug, Clone)]
pub struct Carry {
    pub size: i64,
    pub mtime: i64,
    pub name: String,
    pub md5: Option<String>,
    pub remote_state: String,
    pub remote_id: Option<String>,
}

/// Metadata read from the file (no pixels decoded).
#[derive(Debug, Clone, Default)]
pub struct Meta {
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub taken_at: Option<String>,
    pub camera: Option<String>,
    pub lens: Option<String>,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub format: String,
}

pub fn roots(conn: &Connection) -> rusqlite::Result<Vec<Root>> {
    let mut st = conn.prepare(
        "SELECT r.id, r.path, (SELECT COUNT(*) FROM files f WHERE f.root_id = r.id) \
         FROM roots r ORDER BY r.path",
    )?;
    st.query_map([], |r| {
        Ok(Root {
            id: r.get(0)?,
            path: r.get(1)?,
            file_count: r.get(2)?,
        })
    })?
    .collect()
}

pub fn add_root(conn: &Connection, path: &str, now_ms: i64) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO roots(path, added_ms) VALUES (?1, ?2) ON CONFLICT(path) DO NOTHING",
        params![path, now_ms],
    )?;
    conn.query_row("SELECT id FROM roots WHERE path = ?1", [path], |r| r.get(0))
}

/// Removes a root and its files (loose rows the user asked to upload stay, as loose rows).
pub fn remove_root(conn: &mut Connection, id: i64) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE files SET root_id = NULL WHERE root_id = ?1 AND upload_wanted = 1",
        [id],
    )?;
    tx.execute(
        "DELETE FROM files_fts WHERE rowid IN (SELECT id FROM files WHERE root_id = ?1)",
        [id],
    )?;
    tx.execute("DELETE FROM files WHERE root_id = ?1", [id])?;
    tx.execute("DELETE FROM roots WHERE id = ?1", [id])?;
    tx.commit()
}

/// Moves the files of root `from` to root `to` (a new root that contains an old one).
pub fn merge_root(conn: &Connection, from: i64, to: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE files SET root_id = ?2 WHERE root_id = ?1",
        params![from, to],
    )?;
    conn.execute("DELETE FROM roots WHERE id = ?1", [from])?;
    Ok(())
}

/// (size, mtime) of each known file of a root, by path.
pub fn known_files(
    conn: &Connection,
    root_id: i64,
) -> rusqlite::Result<HashMap<String, (i64, i64)>> {
    let mut st = conn.prepare("SELECT path, size, mtime FROM files WHERE root_id = ?1")?;
    st.query_map([root_id], |r| Ok((r.get(0)?, (r.get(1)?, r.get(2)?))))?
        .collect()
}

/// Paths of a root's files at or below `prefix` (a folder path, no trailing separator).
pub fn paths_under(conn: &Connection, prefix: &str) -> rusqlite::Result<Vec<String>> {
    let mut st = conn.prepare(
        "SELECT path FROM files WHERE root_id IS NOT NULL AND (path = ?1 OR substr(path, 1, ?2) = ?3)",
    )?;
    let with_sep = format!("{prefix}{}", std::path::MAIN_SEPARATOR);
    st.query_map(
        params![prefix, with_sep.chars().count() as i64, with_sep],
        |r| r.get(0),
    )?
    .collect()
}

/// Deletes the given library paths; returns what a rename elsewhere may take over.
pub fn delete_paths(tx: &Transaction, paths: &[String]) -> rusqlite::Result<Vec<Carry>> {
    let mut out = Vec::new();
    let mut sel = tx.prepare(
        "SELECT id, size, mtime, name, md5, remote_state, remote_id FROM files WHERE path = ?1 AND root_id IS NOT NULL",
    )?;
    for p in paths {
        let row = sel
            .query_row([p], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    Carry {
                        size: r.get(1)?,
                        mtime: r.get(2)?,
                        name: r.get(3)?,
                        md5: r.get(4)?,
                        remote_state: r.get(5)?,
                        remote_id: r.get(6)?,
                    },
                ))
            })
            .optional()?;
        if let Some((id, carry)) = row {
            tx.execute("DELETE FROM files_fts WHERE rowid = ?1", [id])?;
            tx.execute("DELETE FROM files WHERE id = ?1", [id])?;
            out.push(carry);
        }
    }
    Ok(out)
}

/// Inserts or updates a file from a walk. Unchanged (same size and mtime) rows are left alone.
/// A changed file loses its metadata, hash and server state, unless `carry` (a file of the same
/// size and mtime that just disappeared: a rename or move) hands them over. Returns whether the
/// row is new or changed.
pub fn upsert(
    tx: &Transaction,
    root_id: Option<i64>,
    f: &FileStat,
    sort_ms: i64,
    carry: Option<&Carry>,
) -> rusqlite::Result<bool> {
    let existing: Option<(i64, i64, i64, Option<i64>)> = tx
        .query_row(
            "SELECT id, size, mtime, root_id FROM files WHERE path = ?1",
            [&f.path],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()?;
    let (md5, state, rid) = match carry {
        Some(c) => (c.md5.clone(), c.remote_state.clone(), c.remote_id.clone()),
        None => (None, remote::UNKNOWN.to_string(), None),
    };
    let state = if state == remote::CHECKING {
        remote::UNKNOWN.to_string()
    } else if state == remote::UPLOADING {
        remote::ABSENT.to_string()
    } else {
        state
    };
    match existing {
        Some((id, size, mtime, old_root)) if size == f.size && mtime == f.mtime => {
            if old_root != root_id && root_id.is_some() {
                tx.execute(
                    "UPDATE files SET root_id = ?2 WHERE id = ?1",
                    params![id, root_id],
                )?;
                reindex(tx, id)?;
                return Ok(true);
            }
            Ok(false)
        }
        Some((id, ..)) => {
            tx.execute(
                "UPDATE files SET root_id = COALESCE(?2, root_id), size = ?3, mtime = ?4, kind = ?5, \
                 sort_ms = ?6, meta_done = 0, width = NULL, height = NULL, taken_at = NULL, camera = NULL, \
                 lens = NULL, lat = NULL, lon = NULL, md5 = ?7, remote_state = ?8, remote_id = ?9, \
                 remote_error = NULL, attempts = 0, next_try_ms = 0, upload_id = NULL, upload_offset = 0 \
                 WHERE id = ?1",
                params![id, root_id, f.size, f.mtime, kind_str(f.kind), sort_ms, md5, state, rid],
            )?;
            reindex(tx, id)?;
            Ok(true)
        }
        None => {
            tx.execute(
                "INSERT INTO files(root_id, path, folder, name, size, mtime, kind, sort_ms, md5, remote_state, remote_id) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    root_id,
                    f.path,
                    f.folder,
                    f.name,
                    f.size,
                    f.mtime,
                    kind_str(f.kind),
                    sort_ms,
                    md5,
                    state,
                    rid
                ],
            )?;
            let id = tx.last_insert_rowid();
            reindex(tx, id)?;
            Ok(true)
        }
    }
}

/// Files whose metadata has not been read yet: (id, path).
pub fn pending_meta(conn: &Connection, limit: i64) -> rusqlite::Result<Vec<(i64, String)>> {
    let mut st = conn.prepare(
        "SELECT id, path FROM files WHERE meta_done = 0 AND root_id IS NOT NULL ORDER BY mtime DESC LIMIT ?1",
    )?;
    st.query_map([limit], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect()
}

pub fn set_meta(
    conn: &Connection,
    id: i64,
    m: &Meta,
    sort_ms: Option<i64>,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE files SET meta_done = 1, width = ?2, height = ?3, taken_at = ?4, camera = ?5, lens = ?6, \
         lat = ?7, lon = ?8, format = ?9, sort_ms = COALESCE(?10, sort_ms) WHERE id = ?1",
        params![
            id, m.width, m.height, m.taken_at, m.camera, m.lens, m.lat, m.lon, m.format, sort_ms
        ],
    )?;
    reindex(conn, id)
}

/// Rewrites the search words of one file from its row (and its root's path).
pub fn reindex(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    let row = conn
        .query_row(
            "SELECT f.path, f.name, f.kind, f.format, f.camera, f.lens, f.sort_ms, f.taken_at, r.path \
             FROM files f LEFT JOIN roots r ON r.id = f.root_id WHERE f.id = ?1",
            [id],
            |r| {
                Ok(super::search::TermSource {
                    path: r.get(0)?,
                    name: r.get(1)?,
                    kind: r.get(2)?,
                    format: r.get(3)?,
                    camera: r.get(4)?,
                    lens: r.get(5)?,
                    sort_ms: r.get(6)?,
                    dated: r.get::<_, Option<String>>(7)?.is_some(),
                    root: r.get(8)?,
                })
            },
        )
        .optional()?;
    conn.execute("DELETE FROM files_fts WHERE rowid = ?1", [id])?;
    if let Some(src) = row {
        conn.execute(
            "INSERT INTO files_fts(rowid, terms) VALUES (?1, ?2)",
            params![id, super::search::terms(&src)],
        )?;
    }
    Ok(())
}

/// Library files, newest first; only those of `root_id` when given.
pub fn list(conn: &Connection, root_id: Option<i64>) -> rusqlite::Result<Vec<LibraryFile>> {
    let sql = format!(
        "SELECT {FILE_COLS} FROM files WHERE root_id IS NOT NULL AND (?1 IS NULL OR root_id = ?1) \
         ORDER BY sort_ms DESC, name DESC"
    );
    let mut st = conn.prepare(&sql)?;
    st.query_map([root_id], file_row)?.collect()
}

/// Full-text search over the library (an FTS5 MATCH expression from `search::fts_query`).
pub fn search(conn: &Connection, fts: &str, limit: i64) -> rusqlite::Result<Vec<LibraryFile>> {
    let cols = FILE_COLS
        .split(", ")
        .map(|c| format!("f.{c}"))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "SELECT {cols} FROM files_fts JOIN files f ON f.id = files_fts.rowid \
         WHERE files_fts MATCH ?1 AND f.root_id IS NOT NULL ORDER BY f.sort_ms DESC LIMIT ?2"
    );
    let mut st = conn.prepare(&sql)?;
    st.query_map(params![fts, limit], file_row)?.collect()
}

/// Files (library or loose) with any of these MD5s.
pub fn by_md5(conn: &Connection, md5s: &[String]) -> rusqlite::Result<Vec<LibraryFile>> {
    let mut st = conn.prepare(&format!(
        "SELECT {FILE_COLS} FROM files WHERE md5 = ?1 ORDER BY root_id IS NULL, sort_ms DESC"
    ))?;
    let mut out = Vec::new();
    for m in md5s {
        for f in st.query_map([m], file_row)? {
            out.push(f?);
        }
    }
    Ok(out)
}

pub fn by_path(conn: &Connection, path: &str) -> rusqlite::Result<Option<LibraryFile>> {
    conn.query_row(
        &format!("SELECT {FILE_COLS} FROM files WHERE path = ?1"),
        [path],
        file_row,
    )
    .optional()
}

pub fn by_id(conn: &Connection, id: i64) -> rusqlite::Result<Option<LibraryFile>> {
    conn.query_row(
        &format!("SELECT {FILE_COLS} FROM files WHERE id = ?1"),
        [id],
        file_row,
    )
    .optional()
}

// ------------------------------------------------------------------ server state

/// A file the worker hashes, checks or uploads.
#[derive(Debug, Clone)]
pub struct Job {
    pub id: i64,
    pub path: String,
    pub name: String,
    pub size: i64,
    pub mtime: i64,
    pub md5: Option<String>,
    pub attempts: i64,
    pub upload_id: Option<String>,
    pub upload_offset: i64,
}

fn job_row(r: &rusqlite::Row) -> rusqlite::Result<Job> {
    Ok(Job {
        id: r.get(0)?,
        path: r.get(1)?,
        name: r.get(2)?,
        size: r.get(3)?,
        mtime: r.get(4)?,
        md5: r.get(5)?,
        attempts: r.get(6)?,
        upload_id: r.get(7)?,
        upload_offset: r.get(8)?,
    })
}

const JOB_COLS: &str = "id, path, name, size, mtime, md5, attempts, upload_id, upload_offset";

/// Claims up to `limit` files whose server state is unknown (library files, newest first, after
/// loose files the user asked to upload).
pub fn claim_checks(conn: &Connection, limit: i64) -> rusqlite::Result<Vec<Job>> {
    let mut st = conn.prepare(&format!(
        "UPDATE files SET remote_state = 'checking' WHERE id IN (\
           SELECT id FROM files WHERE remote_state = 'unknown' AND (root_id IS NOT NULL OR upload_wanted = 1) \
           ORDER BY upload_wanted DESC, sort_ms DESC LIMIT ?1) RETURNING {JOB_COLS}"
    ))?;
    st.query_map([limit], job_row)?.collect()
}

/// Claims the next file to upload: one the user asked for, else (with backup on) the newest
/// library file the server lacks. Failed files come back after their back-off.
pub fn claim_upload(conn: &Connection, backup: bool, now_ms: i64) -> rusqlite::Result<Option<Job>> {
    conn.query_row(
        &format!(
            "UPDATE files SET remote_state = 'uploading' WHERE id = (\
               SELECT id FROM files WHERE remote_state IN ('absent', 'failed') AND next_try_ms <= ?2 \
               AND attempts < ?3 AND (upload_wanted = 1 OR (?1 AND root_id IS NOT NULL)) \
               ORDER BY upload_wanted DESC, sort_ms DESC LIMIT 1) RETURNING {JOB_COLS}"
        ),
        params![backup, now_ms, MAX_ATTEMPTS],
        job_row,
    )
    .optional()
}

/// Soonest retry of a failed upload that is still due (for the worker's sleep).
pub fn next_retry_ms(conn: &Connection, backup: bool) -> rusqlite::Result<Option<i64>> {
    conn.query_row(
        "SELECT MIN(next_try_ms) FROM files WHERE remote_state = 'failed' AND attempts < ?2 \
         AND (upload_wanted = 1 OR (?1 AND root_id IS NOT NULL))",
        params![backup, MAX_ATTEMPTS],
        |r| r.get(0),
    )
}

pub fn set_md5(conn: &Connection, id: i64, md5: &str) -> rusqlite::Result<()> {
    conn.execute("UPDATE files SET md5 = ?2 WHERE id = ?1", params![id, md5])?;
    Ok(())
}

pub fn set_remote(
    conn: &Connection,
    id: i64,
    state: &str,
    remote_id: Option<&str>,
    error: Option<&str>,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE files SET remote_state = ?2, remote_id = ?3, remote_error = ?4 WHERE id = ?1",
        params![id, state, remote_id, error],
    )?;
    if state == remote::PRESENT {
        conn.execute(
            "UPDATE files SET upload_wanted = 0, attempts = 0, upload_id = NULL, upload_offset = 0 WHERE id = ?1",
            [id],
        )?;
    }
    Ok(())
}

pub fn set_failed(
    conn: &Connection,
    id: i64,
    error: &str,
    attempts: i64,
    next_try_ms: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE files SET remote_state = 'failed', remote_error = ?2, attempts = ?3, next_try_ms = ?4 WHERE id = ?1",
        params![id, error, attempts, next_try_ms],
    )?;
    Ok(())
}

pub fn set_upload_progress(
    conn: &Connection,
    id: i64,
    upload_id: Option<&str>,
    offset: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE files SET upload_id = ?2, upload_offset = ?3 WHERE id = ?1",
        params![id, upload_id, offset],
    )?;
    Ok(())
}

/// A different server (or account): everything it knew is unknown again; hashes stay.
pub fn forget_remote(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE files SET remote_state = 'unknown', remote_id = NULL, remote_error = NULL, attempts = 0, \
         next_try_ms = 0, upload_id = NULL, upload_offset = 0",
        [],
    )?;
    Ok(())
}

/// Lets failed uploads try again now.
pub fn retry_failed(conn: &Connection) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE files SET attempts = 0, next_try_ms = 0 WHERE remote_state = 'failed'",
        [],
    )
}

/// Inserts a loose file (outside the library) if it is not known yet; returns its id.
pub fn ensure_loose(tx: &Transaction, f: &FileStat, sort_ms: i64) -> rusqlite::Result<i64> {
    upsert(tx, None, f, sort_ms, None)?;
    tx.query_row("SELECT id FROM files WHERE path = ?1", [&f.path], |r| {
        r.get(0)
    })
}

pub fn want_upload(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE files SET upload_wanted = 1, attempts = 0, next_try_ms = 0 WHERE id = ?1 AND remote_state != 'present'",
        [id],
    )?;
    Ok(())
}

#[derive(Serialize, Debug, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteCounts {
    /// Library files.
    pub total: i64,
    pub unknown: i64,
    pub present: i64,
    pub absent: i64,
    pub uploading: i64,
    pub failed: i64,
    /// Loose files the user asked to upload that are not on the server yet.
    pub wanted: i64,
    /// Library bytes the server does not have yet (absent, failed or uploading).
    pub pending_bytes: i64,
}

pub fn remote_counts(conn: &Connection) -> rusqlite::Result<RemoteCounts> {
    let mut c = RemoteCounts::default();
    let mut st = conn.prepare(
        "SELECT remote_state, COUNT(*), SUM(size) FROM files WHERE root_id IS NOT NULL GROUP BY remote_state",
    )?;
    let rows = st.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, i64>(1)?,
            r.get::<_, Option<i64>>(2)?,
        ))
    })?;
    for row in rows {
        let (state, n, bytes) = row?;
        c.total += n;
        match state.as_str() {
            remote::UNKNOWN | remote::CHECKING => c.unknown += n,
            remote::PRESENT => c.present += n,
            remote::ABSENT => c.absent += n,
            remote::UPLOADING => c.uploading += n,
            remote::FAILED => c.failed += n,
            _ => {}
        }
        if matches!(
            state.as_str(),
            remote::ABSENT | remote::UPLOADING | remote::FAILED
        ) {
            c.pending_bytes += bytes.unwrap_or(0);
        }
    }
    c.wanted = conn.query_row(
        "SELECT COUNT(*) FROM files WHERE upload_wanted = 1 AND remote_state != 'present'",
        [],
        |r| r.get(0),
    )?;
    Ok(c)
}
