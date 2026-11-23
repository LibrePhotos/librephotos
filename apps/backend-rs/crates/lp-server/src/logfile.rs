//! `BASE_LOGS/ownphotos.log`, the file the admin log viewer and download read
//! (`librephotos.logging_bootstrap`): Django's line layout, rotated at 200 MB
//! with 10 backups.

use std::fmt;
use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tracing::{Event, Level, Subscriber};
use tracing_subscriber::fmt::format::Writer;
use tracing_subscriber::fmt::{FmtContext, FormatEvent, FormatFields};
use tracing_subscriber::registry::LookupSpan;

pub use lp_api::stats_admin_stacks_dupes::server::LOG_FILENAME;
/// `DEFAULT_LOG_MAX_BYTES`.
pub const MAX_BYTES: u64 = 200 * 1024 * 1024;
/// `DEFAULT_LOG_BACKUP_COUNT`.
pub const BACKUPS: usize = 10;

/// An append-only log file that rolls over like Python's
/// `RotatingFileHandler`: `x.log` -> `x.log.1` -> ... -> `x.log.<backups>`.
pub struct RotatingFile {
    path: PathBuf,
    max_bytes: u64,
    backups: usize,
    state: Mutex<(Option<File>, u64)>,
}

impl RotatingFile {
    pub fn open(path: impl Into<PathBuf>, max_bytes: u64, backups: usize) -> io::Result<Self> {
        let path = path.into();
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let file = append(&path)?;
        let size = file.metadata()?.len();
        Ok(RotatingFile {
            path,
            max_bytes,
            backups,
            state: Mutex::new((Some(file), size)),
        })
    }

    fn backup(&self, n: usize) -> PathBuf {
        let mut s = self.path.clone().into_os_string();
        s.push(format!(".{n}"));
        s.into()
    }

    /// Another process holding the file open (the worker, on Windows) can
    /// make a rename fail; then the file just keeps growing.
    fn rotate(&self, state: &mut (Option<File>, u64)) {
        if self.backups == 0 {
            return;
        }
        for n in (1..self.backups).rev() {
            let from = self.backup(n);
            if from.exists() {
                let _ = std::fs::rename(&from, self.backup(n + 1));
            }
        }
        // Windows refuses to rename a file we still hold open.
        state.0 = None;
        let _ = std::fs::rename(&self.path, self.backup(1));
        if let Ok(f) = append(&self.path) {
            state.1 = f.metadata().map(|m| m.len()).unwrap_or(0);
            state.0 = Some(f);
        }
    }
}

fn append(path: &Path) -> io::Result<File> {
    OpenOptions::new().create(true).append(true).open(path)
}

impl Write for &RotatingFile {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if self.max_bytes > 0 && state.1 > 0 && state.1 + buf.len() as u64 > self.max_bytes {
            self.rotate(&mut state);
        }
        if state.0.is_none() {
            state.0 = Some(append(&self.path)?);
        }
        state.0.as_mut().expect("just opened").write_all(buf)?;
        state.1 += buf.len() as u64;
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        match self
            .state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .0
            .as_mut()
        {
            Some(f) => f.flush(),
            None => Ok(()),
        }
    }
}

/// `logging_bootstrap.LOG_FORMAT`:
/// `%(asctime)s : %(filename)s : %(funcName)s : %(lineno)s : %(levelname)s : %(message)s`,
/// with the event's module path standing in for the function name.
pub struct DjangoFormat;

impl<S, N> FormatEvent<S, N> for DjangoFormat
where
    S: Subscriber + for<'a> LookupSpan<'a>,
    N: for<'a> FormatFields<'a> + 'static,
{
    fn format_event(
        &self,
        ctx: &FmtContext<'_, S, N>,
        mut writer: Writer<'_>,
        event: &Event<'_>,
    ) -> fmt::Result {
        let meta = event.metadata();
        let file = meta
            .file()
            .map(|f| f.rsplit(['/', '\\']).next().unwrap_or(f))
            .unwrap_or("-");
        let level = match *meta.level() {
            Level::ERROR => "ERROR",
            Level::WARN => "WARNING",
            Level::INFO => "INFO",
            _ => "DEBUG",
        };
        write!(
            writer,
            "{} : {} : {} : {} : {} : ",
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S,%3f"),
            file,
            meta.target(),
            meta.line().unwrap_or(0),
            level,
        )?;
        ctx.format_fields(writer.by_ref(), event)?;
        writeln!(writer)
    }
}
