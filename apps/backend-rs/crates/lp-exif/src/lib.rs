//! In-process ExifTool pool (`exiftool -stay_open True -@ -`), replacing the
//! Python exif sidecar (04 §4). Leaf crate: no internal dependencies, so
//! `lp_core::AppState` can hold an [`ExifPool`].
//!
//! Two lanes like the sidecar: plain processes run with `-G -n` (pyexiftool's
//! default common args), `struct` ones with `-struct` only. Every command ends
//! in `-execute{N}` and is read up to its own `{readyN}`, so a reply can never
//! be taken for another command's; a process that errors or hangs is killed
//! and replaced. [`ExifPool::get_metadata`] is `api/metadata/reader.py`
//! `get_metadata` + the sidecar's batching/attribution, with a small cache so
//! one scan reads each photo once.

#![allow(clippy::disallowed_methods)] // not a handler crate: SQL allowed here

pub mod attribution;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use serde_json::{Map, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Semaphore;

#[derive(Debug, Clone)]
pub struct ExifConfig {
    /// Absolute path on Windows (System32 is searched before PATH).
    pub exiftool: PathBuf,
    pub pool_size: usize,
}

#[derive(Debug, thiserror::Error)]
pub enum ExifError {
    #[error("could not start exiftool ({path}): {source}")]
    Spawn {
        path: String,
        source: std::io::Error,
    },
    #[error("exiftool i/o: {0}")]
    Io(#[from] std::io::Error),
    #[error("exiftool did not answer within {0:?}")]
    Timeout(Duration),
    #[error("exiftool closed its output")]
    Closed,
    #[error("exif service could not read the metadata of {file}: {detail}")]
    Read { file: String, detail: String },
}

/// A command slower than this is stuck on the file (the sidecar had no
/// timeout of its own; the Django client gave up after the EXIF timeout).
const COMMAND_TIMEOUT: Duration = Duration::from_secs(120);
const CACHE_CAPACITY: usize = 20_000;

/// Cheap to clone; processes are started lazily on first use.
#[derive(Debug, Clone)]
pub struct ExifPool {
    inner: Arc<Inner>,
}

#[derive(Debug)]
struct Inner {
    config: ExifConfig,
    plain: Lane,
    structured: Lane,
    cache: Mutex<HashMap<CacheKey, CacheEntry>>,
}

#[derive(Debug)]
struct Lane {
    common_args: &'static [&'static str],
    permits: Semaphore,
    idle: Mutex<Vec<Proc>>,
    seq: AtomicU64,
}

#[derive(Debug)]
struct Proc {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct CacheKey {
    media: PathBuf,
    try_sidecar: bool,
    structured: bool,
}

#[derive(Debug, Clone)]
struct CacheEntry {
    stamps: Vec<(PathBuf, Option<SystemTime>, u64)>,
    values: HashMap<String, Option<Value>>,
}

impl ExifPool {
    pub fn new(config: ExifConfig) -> Self {
        let size = config.pool_size.max(1);
        ExifPool {
            inner: Arc::new(Inner {
                plain: Lane::new(&["-G", "-n"], size),
                structured: Lane::new(&["-struct"], size.min(2)),
                cache: Mutex::new(HashMap::new()),
                config,
            }),
        }
    }

    pub fn config(&self) -> &ExifConfig {
        &self.inner.config
    }

    fn lane(&self, structured: bool) -> &Lane {
        if structured {
            &self.inner.structured
        } else {
            &self.inner.plain
        }
    }

    /// Run one command (the arguments before `-execute`) and return its stdout.
    pub async fn execute(&self, structured: bool, args: &[String]) -> Result<Vec<u8>, ExifError> {
        let lane = self.lane(structured);
        let _permit = lane
            .permits
            .acquire()
            .await
            .map_err(|_| ExifError::Closed)?;
        let popped = lane.idle.lock().expect("exif pool lock").pop();
        let mut proc = match popped {
            Some(p) => p,
            None => Proc::spawn(&self.inner.config.exiftool, lane.common_args)?,
        };
        let seq = lane.seq.fetch_add(1, Ordering::Relaxed) + 1;
        match tokio::time::timeout(COMMAND_TIMEOUT, proc.execute(args, seq)).await {
            Ok(Ok(out)) => {
                lane.idle.lock().expect("exif pool lock").push(proc);
                Ok(out)
            }
            Ok(Err(e)) => {
                proc.kill().await;
                Err(e)
            }
            Err(_) => {
                tracing::warn!("exiftool wedged, killing it");
                proc.kill().await;
                Err(ExifError::Timeout(COMMAND_TIMEOUT))
            }
        }
    }

    /// pyexiftool `execute_json`: `-j` + args; an empty answer (nothing
    /// readable) is an error like `json.loads("")`.
    async fn execute_json(
        &self,
        structured: bool,
        args: Vec<String>,
        file_for_error: &str,
    ) -> Result<Vec<Map<String, Value>>, ExifError> {
        let mut full = Vec::with_capacity(args.len() + 1);
        full.push("-j".to_string());
        full.extend(args);
        let out = self.execute(structured, &full).await?;
        let text = match String::from_utf8(out) {
            Ok(s) => s,
            Err(e) => e.into_bytes().iter().map(|b| *b as char).collect(),
        };
        let parsed: Value = serde_json::from_str(text.trim()).map_err(|e| ExifError::Read {
            file: file_for_error.to_string(),
            detail: e.to_string(),
        })?;
        match parsed {
            Value::Array(items) => Ok(items
                .into_iter()
                .map(|v| match v {
                    Value::Object(m) => m,
                    _ => Map::new(),
                })
                .collect()),
            _ => Err(ExifError::Read {
                file: file_for_error.to_string(),
                detail: "exiftool answered without a list".into(),
            }),
        }
    }

    /// pyexiftool `get_tags_batch`: one command for every tag and file.
    pub async fn get_tags_batch(
        &self,
        tags: &[String],
        files: &[PathBuf],
        structured: bool,
    ) -> Result<Vec<Map<String, Value>>, ExifError> {
        let mut args: Vec<String> = tags.iter().map(|t| format!("-{t}")).collect();
        args.extend(files.iter().map(|f| path_arg(f)));
        let label = files.first().map(|f| path_arg(f)).unwrap_or_default();
        self.execute_json(structured, args, &label).await
    }

    /// pyexiftool `get_tag`: one tag from one file.
    pub async fn get_tag(
        &self,
        tag: &str,
        file: &Path,
        structured: bool,
    ) -> Result<Option<Value>, ExifError> {
        let data = self
            .get_tags_batch(&[tag.to_string()], &[file.to_path_buf()], structured)
            .await?;
        Ok(data.first().and_then(attribution::first_value))
    }

    /// `highest_priority_value`: later files override earlier ones.
    async fn highest_priority_value(
        &self,
        tag: &str,
        files: &[PathBuf],
        structured: bool,
    ) -> Result<Option<Value>, ExifError> {
        let mut value = None;
        for f in files {
            if let Some(v) = self.get_tag(tag, f, structured).await? {
                value = Some(v);
            }
        }
        Ok(value)
    }

    /// The sidecar's `highest_priority_values`.
    async fn highest_priority_values(
        &self,
        tags: &[String],
        files: &[PathBuf],
        structured: bool,
    ) -> Result<Vec<Option<Value>>, ExifError> {
        let per_file = self.get_tags_batch(tags, files, structured).await?;
        if per_file.len() != files.len() {
            let mut out = Vec::with_capacity(tags.len());
            for tag in tags {
                out.push(self.highest_priority_value(tag, files, structured).await?);
            }
            return Ok(out);
        }
        let mut values: Vec<Option<Value>> = vec![None; tags.len()];
        for (file, data) in files.iter().zip(per_file.iter()) {
            let (mut file_values, complete) = attribution::attribute(data, tags);
            if !complete {
                for (i, v) in file_values.iter_mut().enumerate() {
                    if v.is_none() {
                        *v = self.get_tag(&tags[i], file, structured).await?;
                    }
                }
            }
            for (i, v) in file_values.into_iter().enumerate() {
                if v.is_some() {
                    values[i] = v;
                }
            }
        }
        Ok(values)
    }

    /// `api.metadata.reader.get_metadata`: one value per tag (None = absent),
    /// XMP sidecars overriding the media file when `try_sidecar`. Cached per
    /// file set until one of the files changes on disk.
    pub async fn get_metadata(
        &self,
        media_file: &Path,
        tags: &[String],
        try_sidecar: bool,
        structured: bool,
    ) -> Result<Vec<Option<Value>>, ExifError> {
        if tags.is_empty() {
            return Ok(Vec::new());
        }
        let files = existing_metadata_files_reversed(media_file, try_sidecar);
        let stamps: Vec<_> = files.iter().map(|f| stamp(f)).collect();
        let key = CacheKey {
            media: media_file.to_path_buf(),
            try_sidecar,
            structured,
        };
        let missing: Vec<String> = {
            let cache = self.inner.cache.lock().expect("exif cache lock");
            match cache.get(&key) {
                Some(e) if e.stamps == stamps => tags
                    .iter()
                    .filter(|t| !e.values.contains_key(t.as_str()))
                    .cloned()
                    .collect(),
                _ => tags.to_vec(),
            }
        };
        if missing.is_empty() {
            let cache = self.inner.cache.lock().expect("exif cache lock");
            if let Some(e) = cache.get(&key) {
                return Ok(tags.iter().map(|t| e.values[t.as_str()].clone()).collect());
            }
        }
        let fetched = self
            .highest_priority_values(&missing, &files, structured)
            .await
            .map_err(|e| match e {
                ExifError::Read { detail, .. } => ExifError::Read {
                    file: media_file.display().to_string(),
                    detail,
                },
                other => ExifError::Read {
                    file: media_file.display().to_string(),
                    detail: other.to_string(),
                },
            })?;
        let mut cache = self.inner.cache.lock().expect("exif cache lock");
        if cache.len() >= CACHE_CAPACITY {
            cache.clear();
        }
        let entry = cache.entry(key).or_insert_with(|| CacheEntry {
            stamps: stamps.clone(),
            values: HashMap::new(),
        });
        if entry.stamps != stamps {
            entry.stamps = stamps;
            entry.values.clear();
        }
        for (t, v) in missing.iter().zip(fetched) {
            entry.values.insert(t.clone(), v);
        }
        Ok(tags
            .iter()
            .map(|t| entry.values.get(t.as_str()).cloned().flatten())
            .collect())
    }

    /// Forget cached tags of every photo whose files include `path`.
    pub fn invalidate(&self, path: &Path) {
        let mut cache = self.inner.cache.lock().expect("exif cache lock");
        cache.retain(|k, e| k.media != path && !e.stamps.iter().any(|(p, _, _)| p == path));
    }

    /// `api.metadata.writer.write_metadata`: `-TAG=value ... -overwrite_original
    /// <file>` (a list value writes one `-TAG=item` per item), into the first
    /// sidecar name when `use_sidecar`. Returns ExifTool's stdout; like
    /// PyExifTool a failed write is reported there, not raised.
    pub async fn write_metadata(
        &self,
        media_file: &Path,
        tags: &[(String, Value)],
        use_sidecar: bool,
    ) -> Result<String, ExifError> {
        let target = if use_sidecar {
            sidecar_files_in_priority_order(media_file)
                .into_iter()
                .next()
                .expect("four candidates")
        } else {
            media_file.to_path_buf()
        };
        let mut args = Vec::new();
        for (tag, value) in tags {
            match value {
                Value::Array(items) => {
                    for item in items {
                        args.push(format!("-{tag}={}", py_str(item)));
                    }
                }
                other => args.push(format!("-{tag}={}", py_str(other))),
            }
        }
        args.push("-overwrite_original".into());
        args.push(path_arg(&target));
        let out = self.execute(false, &args).await?;
        self.invalidate(media_file);
        self.invalidate(&target);
        Ok(String::from_utf8_lossy(&out).into_owned())
    }

    /// `api.metadata.writer.read_orientation`: the media file's own EXIF
    /// Orientation (1 when absent), None when unreadable.
    pub async fn read_orientation(&self, media_file: &Path) -> Option<i64> {
        match self.get_tag("EXIF:Orientation", media_file, false).await {
            Ok(None) => Some(1),
            Ok(Some(Value::Number(n))) if n.is_i64() => n.as_i64(),
            Ok(Some(_)) => None,
            Err(e) => {
                tracing::warn!(file = %media_file.display(), error = %e, "could not read the orientation");
                None
            }
        }
    }

    /// Stop every idle process (they also die with the pool).
    pub async fn shutdown(&self) {
        for lane in [&self.inner.plain, &self.inner.structured] {
            let procs: Vec<Proc> = std::mem::take(&mut *lane.idle.lock().expect("exif pool lock"));
            for p in procs {
                p.stop().await;
            }
        }
    }
}

impl Lane {
    fn new(common_args: &'static [&'static str], size: usize) -> Self {
        Lane {
            common_args,
            permits: Semaphore::new(size),
            idle: Mutex::new(Vec::new()),
            seq: AtomicU64::new(0),
        }
    }
}

impl Proc {
    fn spawn(exiftool: &Path, common_args: &[&str]) -> Result<Proc, ExifError> {
        let mut cmd = Command::new(exiftool);
        cmd.args(["-stay_open", "True", "-@", "-", "-common_args"])
            .args(common_args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        #[cfg(windows)]
        {
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = cmd.spawn().map_err(|source| ExifError::Spawn {
            path: exiftool.display().to_string(),
            source,
        })?;
        let stdin = child.stdin.take().ok_or(ExifError::Closed)?;
        let stdout = BufReader::new(child.stdout.take().ok_or(ExifError::Closed)?);
        Ok(Proc {
            child,
            stdin,
            stdout,
        })
    }

    async fn execute(&mut self, args: &[String], seq: u64) -> Result<Vec<u8>, ExifError> {
        let mut cmd = String::new();
        for a in args {
            cmd.push_str(a);
            cmd.push('\n');
        }
        cmd.push_str(&format!("-execute{seq}\n"));
        self.stdin.write_all(cmd.as_bytes()).await?;
        self.stdin.flush().await?;
        let sentinel = format!("{{ready{seq}}}");
        let mut out = Vec::new();
        let mut line = Vec::new();
        loop {
            line.clear();
            let n = self.stdout.read_until(b'\n', &mut line).await?;
            if n == 0 {
                return Err(ExifError::Closed);
            }
            let trimmed = trim_ascii(&line);
            if trimmed == sentinel.as_bytes() {
                return Ok(out);
            }
            out.extend_from_slice(&line);
        }
    }

    async fn kill(mut self) {
        let _ = self.child.start_kill();
        let _ = self.child.wait().await;
    }

    async fn stop(mut self) {
        let _ = self.stdin.write_all(b"-stay_open\nFalse\n").await;
        let _ = self.stdin.flush().await;
        if tokio::time::timeout(Duration::from_secs(5), self.child.wait())
            .await
            .is_err()
        {
            let _ = self.child.start_kill();
        }
    }
}

fn trim_ascii(b: &[u8]) -> &[u8] {
    let start = b
        .iter()
        .position(|c| !c.is_ascii_whitespace())
        .unwrap_or(b.len());
    let end = b
        .iter()
        .rposition(|c| !c.is_ascii_whitespace())
        .map_or(start, |i| i + 1);
    &b[start..end]
}

fn stamp(p: &Path) -> (PathBuf, Option<SystemTime>, u64) {
    match std::fs::metadata(p) {
        Ok(m) => (p.to_path_buf(), m.modified().ok(), m.len()),
        Err(_) => (p.to_path_buf(), None, 0),
    }
}

fn path_arg(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// Python `str(value)` for what ends up in `-TAG=value`.
fn py_str(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Bool(true) => "True".into(),
        Value::Bool(false) => "False".into(),
        Value::Null => "None".into(),
        other => other.to_string(),
    }
}

/// `get_sidecar_files_in_priority_order`: `IMG.xmp`, `IMG.XMP`, `IMG.jpg.xmp`, `IMG.jpg.XMP`.
pub fn sidecar_files_in_priority_order(media_file: &Path) -> Vec<PathBuf> {
    let s = media_file.to_string_lossy();
    let base = splitext(&s).0;
    vec![
        PathBuf::from(format!("{base}.xmp")),
        PathBuf::from(format!("{base}.XMP")),
        PathBuf::from(format!("{s}.xmp")),
        PathBuf::from(format!("{s}.XMP")),
    ]
}

/// The files to read, lowest priority first (the media file, then sidecars
/// from the least to the most preferred name).
pub fn existing_metadata_files_reversed(media_file: &Path, try_sidecar: bool) -> Vec<PathBuf> {
    if !try_sidecar {
        return vec![media_file.to_path_buf()];
    }
    let mut files: Vec<PathBuf> = sidecar_files_in_priority_order(media_file)
        .into_iter()
        .filter(|f| f.exists())
        .collect();
    files.push(media_file.to_path_buf());
    files.reverse();
    files
}

/// Python `os.path.splitext` on the full path string (`\` and `/` separators).
pub fn splitext(path: &str) -> (&str, &str) {
    let sep = path.rfind(['/', '\\']).map_or(0, |i| i + 1);
    let name = &path[sep..];
    let leading_dots = name.len() - name.trim_start_matches('.').len();
    match name[leading_dots..].rfind('.') {
        Some(i) => {
            let dot = sep + leading_dots + i;
            (&path[..dot], &path[dot..])
        }
        None => (path, ""),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splitext_like_python() {
        assert_eq!(splitext(r"C:\a\b.jpg"), (r"C:\a\b", ".jpg"));
        assert_eq!(splitext("/a/.hidden"), ("/a/.hidden", ""));
        assert_eq!(splitext("/a.b/c"), ("/a.b/c", ""));
        assert_eq!(splitext("x.tar.gz"), ("x.tar", ".gz"));
        assert_eq!(splitext("/a/..x.jpg"), ("/a/..x", ".jpg"));
    }

    #[test]
    fn sidecar_order() {
        let got = sidecar_files_in_priority_order(Path::new("/p/IMG_1.JPG"));
        assert_eq!(
            got,
            vec![
                PathBuf::from("/p/IMG_1.xmp"),
                PathBuf::from("/p/IMG_1.XMP"),
                PathBuf::from("/p/IMG_1.JPG.xmp"),
                PathBuf::from("/p/IMG_1.JPG.XMP"),
            ]
        );
    }
}
