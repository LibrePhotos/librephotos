//! Helpers shared by several areas. Add here only what at least two areas
//! need; coordinate edits (this file is shared).

pub mod pagination;

pub use pagination::{DrfPage, PageRequest};
