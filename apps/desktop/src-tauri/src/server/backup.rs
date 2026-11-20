//! The native half of the backup engine (CONTRACT.md "Backup"): file bytes, never state. The UI's
//! engine (`src/server/backup.ts`) keeps the queue in the shared local database
//! (`packages/local-db`'s `upload_queue`) and asks the server with `packages/api-client`; Rust
//! hashes files (`fs_md5`) and reads each upload chunk straight into its request (`http`, the
//! api-client's `nativeFilePart`).

use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use md5::{Digest, Md5};

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

#[cfg(test)]
mod tests {
    use super::*;

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
}
