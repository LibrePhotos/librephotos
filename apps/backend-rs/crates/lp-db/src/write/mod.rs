//! Write services: every mutation goes through here (02 §5). There are no
//! signals, so each service performs its side effects (S1..S22 in 02 §5)
//! itself, in the same transaction:
//!
//! * Take `&mut PgConnection` (callers pass `&mut *tx`) when the write must
//!   compose into a caller's transaction; take `&PgPool` and open the
//!   transaction inside when the service is a complete unit.
//! * Bump `last_modified` / `updated_at` yourself on every UPDATE of a model
//!   with Django `auto_now` (S14): Django and Rust take turns on one DB.
//! * Django columns have NO database defaults (Django fills them in Python):
//!   INSERTs must supply every NOT NULL column.
//! * File deletions happen only after commit: collect them in an
//!   [`AfterCommit`] and call `run()` after `tx.commit()`.
//! * Handler crates (`lp-api`, `lp-media`, `lp-auth`) may not call
//!   `sqlx::query*` at all (clippy `disallowed-methods`); reads go in
//!   `lp_db::<area>`, writes in `lp_db::write::<area>`.

use std::path::PathBuf;

pub mod albums_tags;
pub mod auth;
pub mod jobs_zip_services;
pub mod people_faces;
pub mod photo_delete;
pub mod photo_edits;
pub mod search_sharing_public;
pub mod settings;
pub mod stats_admin_stacks_dupes;
pub mod timeline_photos;
pub mod upload;
pub mod users;
pub mod users_settings;

/// Side effects that must only happen once the transaction committed.
#[derive(Debug, Default)]
#[must_use = "call run() after commit"]
pub struct AfterCommit {
    files: Vec<PathBuf>,
}

impl AfterCommit {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn delete_file(&mut self, path: impl Into<PathBuf>) {
        self.files.push(path.into());
    }

    pub fn extend(&mut self, other: AfterCommit) {
        self.files.extend(other.files);
    }

    pub fn is_empty(&self) -> bool {
        self.files.is_empty()
    }

    /// Best effort: a missing file is fine, other errors are logged.
    pub async fn run(self) {
        for f in self.files {
            match tokio::fs::remove_file(&f).await {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => {
                    tracing::warn!(path = %f.display(), error = %e, "after-commit delete failed")
                }
            }
        }
    }
}
