//! Shared application state handed to every handler and job.

use std::sync::Arc;
use std::time::Duration;

use arc_swap::ArcSwap;
use axum::extract::FromRef;
use chrono::{DateTime, Utc};
use jsonwebtoken::{DecodingKey, EncodingKey};
use sqlx::PgPool;
use tokio::sync::{Notify, Semaphore};

use crate::config::Config;
use crate::error::ApiError;
use crate::settings::SiteSettings;

/// HS256 keys derived from `SECRET_KEY` (simplejwt's default `SIGNING_KEY`).
pub struct JwtKeys {
    pub encoding: EncodingKey,
    pub decoding: DecodingKey,
}

impl JwtKeys {
    pub fn from_secret(secret: &str) -> Self {
        JwtKeys {
            encoding: EncodingKey::from_secret(secret.as_bytes()),
            decoding: DecodingKey::from_secret(secret.as_bytes()),
        }
    }
}

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub config: Arc<Config>,
    /// Live site settings; replace via `lp_db::settings::save`, read with [`AppState::settings`].
    pub settings: Arc<ArcSwap<SiteSettings>>,
    /// Shared outbound HTTP client (geocoding, dev fallback proxy, ...).
    pub http: reqwest::Client,
    pub jwt: Arc<JwtKeys>,
    pub exif: lp_exif::ExifPool,
    pub sidecars: lp_sidecars::Sidecars,
    /// Bounds concurrent CPU-heavy work; use [`AppState::blocking`].
    pub cpu: Arc<Semaphore>,
    /// Poked by `lp_jobs::enqueue` so an in-process worker picks jobs up at once.
    pub job_wakeup: Arc<Notify>,
    pub started_at: DateTime<Utc>,
}

impl AppState {
    pub fn new(db: PgPool, config: Config, settings: SiteSettings) -> anyhow::Result<Self> {
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .build()?;
        let exif = lp_exif::ExifPool::new(lp_exif::ExifConfig {
            exiftool: config.binaries.exiftool.clone(),
            pool_size: config.exif_pool,
        });
        let sidecars = lp_sidecars::Sidecars::new(http.clone(), "127.0.0.1");
        Ok(AppState {
            db,
            jwt: Arc::new(JwtKeys::from_secret(&config.secret_key)),
            cpu: Arc::new(Semaphore::new(config.cores.max(1))),
            config: Arc::new(config),
            settings: Arc::new(ArcSwap::from_pointee(settings)),
            http,
            exif,
            sidecars,
            job_wakeup: Arc::new(Notify::new()),
            started_at: Utc::now(),
        })
    }

    /// Current site settings snapshot.
    pub fn settings(&self) -> Arc<SiteSettings> {
        self.settings.load_full()
    }

    /// Run CPU-heavy work on the blocking pool, bounded by `cpu`.
    pub async fn blocking<F, R>(&self, f: F) -> Result<R, ApiError>
    where
        F: FnOnce() -> R + Send + 'static,
        R: Send + 'static,
    {
        let _permit = self
            .cpu
            .clone()
            .acquire_owned()
            .await
            .map_err(ApiError::internal)?;
        Ok(tokio::task::spawn_blocking(f).await?)
    }
}

impl FromRef<AppState> for PgPool {
    fn from_ref(s: &AppState) -> PgPool {
        s.db.clone()
    }
}

impl FromRef<AppState> for Arc<Config> {
    fn from_ref(s: &AppState) -> Arc<Config> {
        s.config.clone()
    }
}
