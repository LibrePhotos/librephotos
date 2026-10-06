//! Database layer: pool, migrations (`adopt`), row types, authorization
//! scopes, the shared photo summary and the write services.
//!
//! Runtime-checked sqlx only (`sqlx::query_as::<_, T>(sql)` + `FromRow`,
//! `QueryBuilder` for dynamic SQL); no `query!` macros, so nothing needs a
//! database at build time.
//!
//! Area code: reads in `lp_db::<area>`, writes in `lp_db::write::<area>`.

#![allow(clippy::disallowed_methods)] // not a handler crate: SQL allowed here

pub mod adopt;
pub mod db;
pub mod health;
pub mod migrate;
pub mod pig;
pub mod pool;
pub mod scope;
pub mod settings;
pub mod users;
pub mod write;

// One module per API area; each area owns its own directory.
pub mod albums_tags;
pub mod jobs_zip_services;
pub mod media;
pub mod people_faces;
pub mod photo_edits;
pub mod search_sharing_public;
pub mod stats_admin_stacks_dupes;
pub mod sync;
pub mod timeline_photos;
pub mod upload;
pub mod users_settings;

pub use pool::connect;
pub use sqlx::{PgPool, Postgres, QueryBuilder};
