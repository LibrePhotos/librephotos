//! The area's `DeletionLog` writes. [`crate::write::deletion_log`] handles both
//! dialects (SQLite with a Rust timestamp), so this only re-exports it.

pub use crate::write::deletion_log::persons_deleted;
