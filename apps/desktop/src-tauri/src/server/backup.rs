//! The native half of the backup engine (CONTRACT.md "Backup"): everything but the network.
//!
//! The UI's engine (`src/server/backup.ts`) asks the server with `packages/api-client`
//! (`uploadExists`, `uploadChunk`, `completeUpload`, `sealUploadImports`) and keeps its state
//! here, in the library database, so a restart picks up where the last run stopped:
//!
//! - claims: files to check (`unknown` -> `checking`) and to upload (`absent`/`failed` ->
//!   `uploading`), newest first, a file whose MD5 is being uploaded never twice;
//! - MD5 of a file (streamed, off the async threads), stored per file;
//! - outcomes: present (with the photo id; copies with the same MD5 follow), absent, failed with
//!   the next try time, and the resumable upload's id and offset after every chunk;
//! - chunk reads, which `http` splices into the upload request (the api-client's `nativeFilePart`).

use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use md5::{Digest, Md5};
use serde::Serialize;

use super::{RemoteOf, Server};
use crate::library::db::{self, Job, remote};
use crate::library::{file_stat, local_wall_ms};

/// The largest chunk a request may carry.
pub const MAX_CHUNK: i64 = 64 * 1024 * 1024;

/// MD5 of a file, lower-case hex, read in 1 MB blocks.
pub fn md5_file(path: &Path) -> std::io::Result<String> {
    let mut f = std::fs::File::open(path)?;
    let mut h = Md5::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

fn read_chunk(path: &str, offset: i64, len: i64) -> std::io::Result<Vec<u8>> {
    let mut f = std::fs::File::open(path)?;
    f.seek(SeekFrom::Start(offset as u64))?;
    let mut buf = vec![0u8; len as usize];
    f.read_exact(&mut buf)?;
    Ok(buf)
}

/// `len` bytes of the file at `path` from `offset`, for a path-based `nativeFilePart`: only
/// pictures and videos the library keeps, at most [`MAX_CHUNK`].
pub fn read_chunk_at(path: &str, offset: i64, len: i64) -> Result<Vec<u8>, String> {
    if offset < 0 || len <= 0 || len > MAX_CHUNK {
        return Err(format!("bad chunk {offset}+{len}"));
    }
    if crate::formats::kind_of(Path::new(path)).is_none() {
        return Err(format!("{path}: not a picture or video"));
    }
    read_chunk(path, offset, len).map_err(|e| format!("{path}: {e}"))
}

/// What an upload starts from: the file as it is now, and where a previous run stopped.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Prepared {
    pub md5: String,
    pub size: i64,
    /// The file's modified time (ms), for `device_modified_at`.
    pub mtime: i64,
    /// The server's upload to continue, when the file did not change since.
    pub upload_id: Option<String>,
    pub offset: i64,
}

fn err(e: impl ToString) -> String {
    e.to_string()
}

impl Server {
    fn job(&self, id: i64) -> Result<Job, String> {
        db::job_by_id(&self.lib.conn(), id)
            .map_err(err)?
            .ok_or_else(|| format!("no library file {id}"))
    }

    /// Checks and uploads a previous UI left half done start over.
    pub fn backup_reset(&self) -> Result<(), String> {
        db::reset_in_flight(&self.lib.conn()).map_err(err)?;
        self.lib.notify_changed();
        Ok(())
    }

    pub fn claim_checks(&self, limit: i64) -> Result<Vec<Job>, String> {
        db::claim_checks(&self.lib.conn(), limit.clamp(1, 256)).map_err(err)
    }

    pub fn claim_upload(&self) -> Result<Option<Job>, String> {
        let s = self.settings();
        if s.paused {
            return Ok(None);
        }
        let now = chrono::Utc::now().timestamp_millis();
        db::claim_upload(&self.lib.conn(), s.backup, now).map_err(err)
    }

    /// Soonest retry of a failed upload that is still due, ms since the epoch.
    pub fn next_retry(&self) -> Result<Option<i64>, String> {
        db::next_retry_ms(&self.lib.conn(), self.settings().backup).map_err(err)
    }

    /// The file's MD5, hashed now (blocking) and stored when it was not known.
    pub fn hash(&self, id: i64) -> Result<String, String> {
        let job = self.job(id)?;
        if let Some(m) = job.md5 {
            return Ok(m);
        }
        let m = md5_file(Path::new(&job.path)).map_err(|e| format!("{}: {e}", job.path))?;
        db::set_md5(&self.lib.conn(), id, &m).map_err(err)?;
        Ok(m)
    }

    /// Re-reads the file before an upload: a changed file is hashed again and starts over.
    pub fn prepare(&self, id: i64) -> Result<Prepared, String> {
        let job = self.job(id)?;
        let meta = std::fs::metadata(&job.path).map_err(|e| format!("{}: {e}", job.path))?;
        let size = meta.len() as i64;
        if size == 0 {
            return Err("the file is empty".into());
        }
        let mtime = crate::listing::modified_ms(&meta);
        let fresh = size == job.size && mtime == job.mtime;
        let md5 = match (&job.md5, fresh) {
            (Some(m), true) => m.clone(),
            _ => {
                let m = md5_file(Path::new(&job.path)).map_err(|e| format!("{}: {e}", job.path))?;
                db::set_md5(&self.lib.conn(), id, &m).map_err(err)?;
                m
            }
        };
        let (upload_id, offset) = match job.upload_id {
            Some(u) if fresh => (Some(u), job.upload_offset.clamp(0, size)),
            _ => (None, 0),
        };
        Ok(Prepared {
            md5,
            size,
            mtime,
            upload_id,
            offset,
        })
    }

    pub fn read_chunk(&self, id: i64, offset: i64, len: i64) -> Result<Vec<u8>, String> {
        if offset < 0 || len <= 0 || len > MAX_CHUNK {
            return Err(format!("bad chunk {offset}+{len}"));
        }
        let job = self.job(id)?;
        read_chunk(&job.path, offset, len).map_err(|e| format!("{}: {e}", job.path))
    }

    /// Records the server's answer about a file: `present` (with its photo id), `absent`, or
    /// `unknown` (ask again).
    pub fn set_remote(&self, id: i64, state: &str, photo_id: Option<&str>) -> Result<(), String> {
        let state = match state {
            "present" => remote::PRESENT,
            "absent" => remote::ABSENT,
            "unknown" => remote::UNKNOWN,
            other => return Err(format!("not a server state: {other}")),
        };
        db::set_remote(&self.lib.conn(), id, state, photo_id, None).map_err(err)?;
        self.lib.notify_changed();
        Ok(())
    }

    pub fn set_failed(
        &self,
        id: i64,
        error: &str,
        attempts: i64,
        next_try_ms: i64,
    ) -> Result<(), String> {
        db::set_failed(&self.lib.conn(), id, error, attempts, next_try_ms).map_err(err)?;
        self.lib.notify_changed();
        Ok(())
    }

    pub fn set_progress(
        &self,
        id: i64,
        upload_id: Option<&str>,
        offset: i64,
    ) -> Result<(), String> {
        db::set_upload_progress(&self.lib.conn(), id, upload_id, offset).map_err(err)
    }

    /// The row of `path`, made a loose row when it is not in the library.
    fn row_of(&self, path: &str) -> Result<db::LibraryFile, String> {
        let meta = std::fs::metadata(path).map_err(|e| format!("{path}: {e}"))?;
        let stat = file_stat(Path::new(path), &meta).ok_or("not a picture or video")?;
        let mut conn = self.lib.conn();
        let tx = conn.transaction().map_err(err)?;
        let id = db::ensure_loose(&tx, &stat, local_wall_ms(stat.mtime)).map_err(err)?;
        tx.commit().map_err(err)?;
        db::by_id(&conn, id)
            .map_err(err)?
            .ok_or_else(|| "vanished".to_string())
    }

    /// What the library knows about a local file, hashing it when needed. `id` is the row the UI
    /// reports the server's answer for (`backup_set_remote`).
    pub fn local_of(&self, path: &str) -> Result<(i64, RemoteOf), String> {
        let row = self.row_of(path)?;
        let md5 = match row.md5 {
            Some(m) => m,
            None => self.hash(row.id)?,
        };
        Ok((
            row.id,
            RemoteOf {
                state: row.remote,
                photo_id: row.remote_id,
                image_hash: self.user_id().map(|u| format!("{md5}{u}")),
                md5: Some(md5),
                in_library: row.root_id.is_some(),
            },
        ))
    }

    /// Queues one file (in the library or not) for upload.
    pub fn upload_file(&self, path: &str) -> Result<RemoteOf, String> {
        if !self.connected() {
            return Err("Connect to a LibrePhotos server first".into());
        }
        let row = self.row_of(path)?;
        db::want_upload(&self.lib.conn(), row.id).map_err(err)?;
        if row.remote == remote::FAILED {
            let _ = db::set_remote(&self.lib.conn(), row.id, remote::UNKNOWN, None, None);
        }
        self.lib.notify_changed();
        self.changed();
        Ok(RemoteOf {
            state: row.remote,
            photo_id: row.remote_id,
            md5: row.md5,
            image_hash: None,
            in_library: row.root_id.is_some(),
        })
    }

    pub fn retry_failed(&self) -> Result<usize, String> {
        let n = db::retry_failed(&self.lib.conn()).map_err(err)?;
        self.lib.notify_changed();
        Ok(n)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::Library;
    use crate::server::{SignIn, auth};
    use std::sync::Arc;

    #[test]
    fn hashes_files() {
        let p = std::env::temp_dir().join(format!("lpview-md5-{}", std::process::id()));
        std::fs::write(&p, b"hello").unwrap();
        assert_eq!(md5_file(&p).unwrap(), "5d41402abc4b2a76b9719d911017c592");
        assert_eq!(read_chunk(p.to_str().unwrap(), 1, 3).unwrap(), b"ell");
        assert!(
            read_chunk_at(p.to_str().unwrap(), 0, 2).is_err(),
            "not a picture"
        );
        let jpg = p.with_extension("jpg");
        std::fs::copy(&p, &jpg).unwrap();
        assert_eq!(read_chunk_at(jpg.to_str().unwrap(), 1, 3).unwrap(), b"ell");
        assert!(read_chunk_at(jpg.to_str().unwrap(), 0, MAX_CHUNK + 1).is_err());
        assert!(
            read_chunk_at(jpg.to_str().unwrap(), 3, 9).is_err(),
            "past the end"
        );
        std::fs::remove_file(&jpg).unwrap();
        std::fs::remove_file(&p).unwrap();
    }

    fn connected_server(dir: &Path) -> Arc<Server> {
        let lib = Library::open(db::open_memory().unwrap(), |_| ());
        let s = Server::new(
            lib,
            dir.to_path_buf(),
            Box::new(auth::MemoryStore::default()),
            Box::new(|| ()),
        );
        s.prepare_sign_in("http://h").unwrap();
        s.signed_in(SignIn {
            url: "http://h".into(),
            username: "u".into(),
            user_id: 9,
            refresh: "r".into(),
            access: "a".into(),
        })
        .unwrap();
        s
    }

    #[test]
    fn queue_round_trip_survives_a_reset() {
        let dir = std::env::temp_dir().join(format!("lpview-backup-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let a = dir.join("a.jpg");
        let b = dir.join("copy of a.jpg");
        std::fs::write(&a, b"hello").unwrap();
        std::fs::write(&b, b"hello").unwrap();
        let s = connected_server(&dir);

        // A file opened from anywhere: hashed, and its image hash carries the user id.
        let (id, local) = s.local_of(a.to_str().unwrap()).unwrap();
        assert_eq!(
            local.image_hash.as_deref(),
            Some("5d41402abc4b2a76b9719d911017c5929")
        );
        s.upload_file(a.to_str().unwrap()).unwrap();
        let (copy, _) = s.local_of(b.to_str().unwrap()).unwrap();
        s.set_remote(id, "absent", None).unwrap();
        s.set_remote(copy, "absent", None).unwrap();
        s.upload_file(b.to_str().unwrap()).unwrap();

        // Claimed once; the copy with the same MD5 waits while it uploads.
        let job = s.claim_upload().unwrap().unwrap();
        assert!(s.claim_upload().unwrap().is_none());
        let p = s.prepare(job.id).unwrap();
        assert_eq!((p.size, p.offset, p.upload_id.clone()), (5, 0, None));
        assert_eq!(s.read_chunk(job.id, 0, 5).unwrap(), b"hello");
        assert!(s.read_chunk(job.id, 0, MAX_CHUNK + 1).is_err());
        s.set_progress(job.id, Some("up1"), 3).unwrap();

        // The UI reloads mid-upload: the upload resumes from its offset.
        s.backup_reset().unwrap();
        let again = s.claim_upload().unwrap().unwrap();
        assert_eq!(again.id, job.id);
        let p = s.prepare(again.id).unwrap();
        assert_eq!((p.upload_id.as_deref(), p.offset), (Some("up1"), 3));

        // Done: the copy is on the server too, without a request.
        s.set_remote(again.id, "present", Some("photo-1")).unwrap();
        assert!(s.claim_upload().unwrap().is_none());
        let (_, copy_now) = s.local_of(b.to_str().unwrap()).unwrap();
        assert_eq!(copy_now.state, "present");
        assert_eq!(copy_now.photo_id.as_deref(), Some("photo-1"));
        assert!(s.set_remote(id, "uploading", None).is_err());

        // Pausing stops claims; failures wait for their retry time.
        s.set_failed(copy, "HTTP 400", 1, i64::MAX).unwrap();
        s.set_paused(true).unwrap();
        assert!(s.claim_upload().unwrap().is_none());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
