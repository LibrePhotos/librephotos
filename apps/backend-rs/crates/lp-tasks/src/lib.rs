//! Background follow-ups that call the ML sidecars or external services
//! (04 §3): tags, geocoding, CLIP, similarity, faces, OCR, captions,
//! auto albums, duplicates, stacks, model downloads, metadata write-back.
//!
//! TODO(tasks agents): implement; register job kinds in [`register_jobs`].

#![allow(clippy::disallowed_methods)] // not a handler crate: SQL allowed here

use lp_jobs::HandlerRegistry;

pub fn register_jobs(_reg: &mut HandlerRegistry) {}
