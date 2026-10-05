//! Scan pipeline (04 §5): walk + group, known-file check, sniff, MD5 hash,
//! motion photos, EXIF via `lp-exif`, dates, thumbnails, video, pHash,
//! aspect ratio (`lp_core::codecs::aspect_ratio`), dominant color, follow-ups.
//!
//! Entry points: [`register_jobs`] (the job kinds below), [`scan::scan_user`]
//! and [`upload`] for the chunked-upload endpoints.

#![allow(clippy::disallowed_methods)] // not a handler crate: SQL allowed here

pub mod color;
pub mod dates;
pub mod db;
pub mod exifmap;
pub mod face_tags;
pub mod fsutil;
pub mod inline;
pub mod jobs;
pub mod phash;
pub mod pipeline;
pub mod pyfmt;
pub mod render;
pub mod repair;
pub mod scan;
pub mod upload;
pub mod vips;

pub use pipeline::{Owner, Pipeline};

use lp_jobs::HandlerRegistry;

/// `scan.user`, `scan.file_group`, `thumbnails.rerender`, `metadata.write`, `metadata.face_tags`,
/// `delete.missing_photos`, `repair.file_variants`, `upload.process`.
pub fn register_jobs(reg: &mut HandlerRegistry) {
    jobs::register(reg);
}
