//! Scan pipeline (04 §5): walk + group, known-file check, sniff, MD5 hash,
//! motion photos, EXIF via `lp-exif`, dates, thumbnails, video, pHash,
//! aspect ratio (`lp_core::codecs::aspect_ratio`), dominant color, follow-ups.
//!
//! TODO(ingest agent): implement; register job kinds in [`register_jobs`].

#![allow(clippy::disallowed_methods)] // not a handler crate: SQL allowed here

use lp_jobs::HandlerRegistry;

/// `scan.user`, `scan.file_group`, `repair.file_variants`, `delete.missing_photos`, ...
pub fn register_jobs(_reg: &mut HandlerRegistry) {}
