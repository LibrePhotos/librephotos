//! The area's `DeletionLog` writes: [`crate::write::deletion_log`] on both
//! dialects (it inserts SQLite tombstones with a Rust timestamp itself).

pub use crate::write::deletion_log::{albums_deleted, clear, tags_deleted, unshared};
