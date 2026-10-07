//! Foundation shared by every crate: configuration, [`AppState`], the error
//! envelope, request extractors and Django-compatible codecs.

#![allow(clippy::disallowed_methods)] // not a handler crate: SQL allowed here

pub mod codecs;
pub mod config;
pub mod db;
pub mod django_crypto;
pub mod error;
pub mod extract;
pub mod settings;
pub mod state;
pub mod time;

pub use config::{Config, MediaMode};
pub use error::{ApiError, ApiResult, FieldError};
pub use extract::{ApiJson, ApiQuery, QueryMap};
pub use settings::SiteSettings;
pub use state::{AppState, JwtKeys};
