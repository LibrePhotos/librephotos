//! In-process ExifTool pool (`exiftool -stay_open True -@ -`), replacing the
//! Python exif sidecar (04 §4). Leaf crate: no internal dependencies, so
//! `lp_core::AppState` can hold an [`ExifPool`].
//!
//! TODO(exif agent): processes, `-execute{N}` sentinels, respawn of wedged
//! processes, read (plain + `-struct`) and write APIs, per-scan tag cache.

#![allow(clippy::disallowed_methods)] // not a handler crate: SQL allowed here

use std::path::PathBuf;
use std::sync::Arc;

#[derive(Debug, Clone)]
pub struct ExifConfig {
    /// Absolute path on Windows (System32 is searched before PATH).
    pub exiftool: PathBuf,
    pub pool_size: usize,
}

/// Cheap to clone; processes are started lazily on first use.
#[derive(Debug, Clone)]
pub struct ExifPool {
    inner: Arc<Inner>,
}

#[derive(Debug)]
struct Inner {
    config: ExifConfig,
}

impl ExifPool {
    pub fn new(config: ExifConfig) -> Self {
        ExifPool {
            inner: Arc::new(Inner { config }),
        }
    }

    pub fn config(&self) -> &ExifConfig {
        &self.inner.config
    }
}
