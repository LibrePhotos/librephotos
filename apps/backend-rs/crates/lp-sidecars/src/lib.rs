//! Typed HTTP clients for the Python ML sidecars (04 §4). The contracts stay
//! exactly as today: file paths in, JSON out. Leaf crate: no internal
//! dependencies, so `lp_core::AppState` can hold a [`Sidecars`].
//!
//! Call policy (`api/sidecars.py`, `api/http_timeouts.py`): 5 s to connect,
//! a per-sidecar read budget ([`Sidecar::timeout`]), and three attempts in
//! all for what a busy or restarting sidecar transiently does (refuse or drop
//! the connection, answer 503), 0 s then 1 s apart. A timed-out read is never
//! retried: the sidecar is most likely still working on the first request.
//! Any other error status is a [`SidecarError::Status`] carrying the
//! sidecar's own `{"error"}` text.

#![allow(clippy::disallowed_methods)] // not a handler crate: SQL allowed here

pub mod supervisor;

use std::time::Duration;

use std::collections::HashMap;
use std::sync::Arc;

mod client;
pub mod types;

pub use client::{SidecarError, error_detail};
pub use types::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Sidecar {
    Similarity,
    Thumbnail,
    Face,
    Clip,
    Caption,
    Tags,
    Ocr,
    FaceCluster,
}

/// `http_timeouts.CONNECT_TIMEOUT`.
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
/// `http_timeouts.HEALTH_CHECK` read budget.
pub const HEALTH_TIMEOUT: Duration = Duration::from_secs(5);
/// `http_timeouts.UNLOAD_MODEL` read budget.
pub const UNLOAD_TIMEOUT: Duration = Duration::from_secs(30);

impl Sidecar {
    pub const ALL: [Sidecar; 8] = [
        Sidecar::Similarity,
        Sidecar::Thumbnail,
        Sidecar::Face,
        Sidecar::Clip,
        Sidecar::Caption,
        Sidecar::Tags,
        Sidecar::Ocr,
        Sidecar::FaceCluster,
    ];

    /// Service directory name under `apps/backend/service/` (`api/sidecars.py`).
    pub fn name(self) -> &'static str {
        match self {
            Sidecar::Similarity => "image_similarity",
            Sidecar::Thumbnail => "thumbnail",
            Sidecar::Face => "face_recognition",
            Sidecar::Clip => "clip_embeddings",
            Sidecar::Caption => "image_captioning",
            Sidecar::Tags => "tags",
            Sidecar::Ocr => "ocr",
            Sidecar::FaceCluster => "face_cluster",
        }
    }

    pub fn port(self) -> u16 {
        match self {
            Sidecar::Similarity => 8002,
            Sidecar::Thumbnail => 8003,
            Sidecar::Face => 8005,
            Sidecar::Clip => 8006,
            Sidecar::Caption => 8007,
            Sidecar::Tags => 8011,
            Sidecar::Ocr => 8012,
            Sidecar::FaceCluster => 8013,
        }
    }

    /// Today's per-sidecar read timeouts (`api/http_timeouts.py`). The new
    /// face_cluster sidecar runs HDBSCAN / MLP fits over a whole library,
    /// which Django did in-process without any timeout, so it gets 30 min.
    pub fn timeout(self) -> Duration {
        Duration::from_secs(match self {
            Sidecar::Face | Sidecar::Similarity | Sidecar::Tags => 60,
            Sidecar::Thumbnail | Sidecar::Clip => 120,
            Sidecar::Caption | Sidecar::Ocr => 180,
            Sidecar::FaceCluster => 1800,
        })
    }

    /// `LP_SIDECAR_<NAME>_URL`, e.g. `LP_SIDECAR_FACE_CLUSTER_URL`.
    pub fn url_env(self) -> String {
        let name = match self {
            Sidecar::Similarity => "SIMILARITY",
            Sidecar::Thumbnail => "THUMBNAIL",
            Sidecar::Face => "FACE",
            Sidecar::Clip => "CLIP",
            Sidecar::Caption => "CAPTION",
            Sidecar::Tags => "TAGS",
            Sidecar::Ocr => "OCR",
            Sidecar::FaceCluster => "FACE_CLUSTER",
        };
        format!("LP_SIDECAR_{name}_URL")
    }
}

/// The sidecar clients. Cheap to clone. Base URLs default to
/// `http://<host>:<port>` and can be redirected per sidecar, by
/// `LP_SIDECAR_<NAME>_URL` or [`Sidecars::with_base`] (tests, mocks).
#[derive(Debug, Clone)]
pub struct Sidecars {
    http: reqwest::Client,
    host: String,
    bases: Arc<HashMap<Sidecar, String>>,
    timeouts: Arc<HashMap<Sidecar, Duration>>,
}

impl Sidecars {
    pub fn new(http: reqwest::Client, host: impl Into<String>) -> Self {
        let bases = Sidecar::ALL
            .iter()
            .filter_map(|s| {
                std::env::var(s.url_env())
                    .ok()
                    .map(|v| v.trim().trim_end_matches('/').to_string())
                    .filter(|v| !v.is_empty())
                    .map(|v| (*s, v))
            })
            .collect();
        Sidecars {
            http,
            host: host.into(),
            bases: Arc::new(bases),
            timeouts: Arc::new(HashMap::new()),
        }
    }

    /// Send `sidecar`'s requests to `base` (e.g. `http://127.0.0.1:18005`).
    pub fn with_base(mut self, sidecar: Sidecar, base: impl Into<String>) -> Self {
        let base = base.into().trim_end_matches('/').to_string();
        Arc::make_mut(&mut self.bases).insert(sidecar, base);
        self
    }

    /// Override `sidecar`'s read budget (tests).
    pub fn with_timeout(mut self, sidecar: Sidecar, timeout: Duration) -> Self {
        Arc::make_mut(&mut self.timeouts).insert(sidecar, timeout);
        self
    }

    pub fn base(&self, sidecar: Sidecar) -> String {
        self.bases
            .get(&sidecar)
            .cloned()
            .unwrap_or_else(|| format!("http://{}:{}", self.host, sidecar.port()))
    }

    /// Whether `sidecar`'s base was set explicitly (`LP_SIDECAR_<NAME>_URL`
    /// or [`Sidecars::with_base`]); `lp-ml` then keeps calling the sidecar.
    pub fn is_redirected(&self, sidecar: Sidecar) -> bool {
        self.bases.contains_key(&sidecar)
    }

    pub fn url(&self, sidecar: Sidecar, path: &str) -> String {
        format!("{}{}", self.base(sidecar), path)
    }

    pub fn http(&self) -> &reqwest::Client {
        &self.http
    }

    pub fn timeout(&self, sidecar: Sidecar) -> Duration {
        self.timeouts
            .get(&sidecar)
            .copied()
            .unwrap_or_else(|| sidecar.timeout())
    }
}
