//! Shared application state handed to every handler and job.

use std::sync::Arc;
use std::time::Duration;

use arc_swap::ArcSwap;
use axum::extract::FromRef;
use chrono::{DateTime, Utc};
use jsonwebtoken::{DecodingKey, EncodingKey};
use tokio::sync::{Notify, Semaphore};

use crate::config::Config;
use crate::db::Db;
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
    pub db: Db,
    pub config: Arc<Config>,
    /// Live site settings; replace via `lp_db::settings::save`, read with [`AppState::settings`].
    pub settings: Arc<ArcSwap<SiteSettings>>,
    /// Shared outbound HTTP client (geocoding, dev fallback proxy, ...).
    pub http: reqwest::Client,
    pub jwt: Arc<JwtKeys>,
    pub exif: lp_exif::ExifPool,
    pub sidecars: lp_sidecars::Sidecars,
    /// In-process ML services; call them through [`AppState::ml`].
    pub ml: lp_ml::Ml,
    /// Bounds concurrent CPU-heavy work; use [`AppState::blocking`].
    pub cpu: Arc<Semaphore>,
    /// Poked by `lp_jobs::enqueue` so an in-process worker picks jobs up at once.
    pub job_wakeup: Arc<Notify>,
    pub started_at: DateTime<Utc>,
}

impl AppState {
    pub fn new(db: Db, config: Config, settings: SiteSettings) -> anyhow::Result<Self> {
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .build()?;
        let exif = lp_exif::ExifPool::new(lp_exif::ExifConfig {
            exiftool: config.binaries.exiftool.clone(),
            pool_size: config.exif_pool,
            idle_timeout: (config.exif_idle_secs > 0)
                .then(|| Duration::from_secs(config.exif_idle_secs)),
        });
        let sidecars = lp_sidecars::Sidecars::new(http.clone(), "127.0.0.1");
        let settings = Arc::new(ArcSwap::from_pointee(settings));
        let live = settings.clone();
        let ml = lp_ml::Ml::new(
            lp_ml::MlConfig::from_env(config.media_root.clone()),
            Arc::new(move || {
                let s = live.load();
                lp_ml::Selection {
                    tagging_model: s.tagging_model.clone(),
                    face_recognition_model: s.face_recognition_model.clone(),
                    ocr_model: s.ocr_model.clone(),
                    captioning_model: s.captioning_model.clone(),
                    semantic_search_model: s.semantic_search_model.clone(),
                }
            }),
        );
        Ok(AppState {
            db,
            jwt: Arc::new(JwtKeys::from_secret(&config.secret_key)),
            cpu: Arc::new(Semaphore::new(config.cores.max(1))),
            config: Arc::new(config),
            settings,
            http,
            exif,
            sidecars,
            ml,
            job_wakeup: Arc::new(Notify::new()),
            started_at: Utc::now(),
        })
    }

    /// The ML services (in-process or sidecar per `LP_ML_<SERVICE>`), e.g.
    /// `state.ml().clip().query_embedding(..)`.
    pub fn ml(&self) -> lp_ml::MlView<'_> {
        self.ml.view(&self.sidecars)
    }

    /// Owned ML handle for blocking code that cannot borrow the state.
    pub fn ml_handle(&self) -> lp_ml::MlHandle {
        lp_ml::MlHandle {
            ml: self.ml.clone(),
            sidecars: self.sidecars.clone(),
        }
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

impl FromRef<AppState> for Db {
    fn from_ref(s: &AppState) -> Db {
        s.db.clone()
    }
}

impl FromRef<AppState> for Arc<Config> {
    fn from_ref(s: &AppState) -> Arc<Config> {
        s.config.clone()
    }
}
