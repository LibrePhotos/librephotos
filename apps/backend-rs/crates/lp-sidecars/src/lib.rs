//! Typed HTTP clients for the Python ML sidecars (04 §4). The contracts stay
//! exactly as today: file paths in, JSON out. Leaf crate: no internal
//! dependencies, so `lp_core::AppState` can hold a [`Sidecars`].
//!
//! TODO(sidecar agent): typed request/response per endpoint, retries (twice
//! on connect errors or 503, never on a read timeout), supervisor.

#![allow(clippy::disallowed_methods)] // not a handler crate: SQL allowed here

pub mod supervisor;

use std::time::Duration;

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

    /// Today's per-sidecar request timeouts.
    pub fn timeout(self) -> Duration {
        Duration::from_secs(match self {
            Sidecar::Face | Sidecar::Similarity | Sidecar::Tags | Sidecar::FaceCluster => 60,
            Sidecar::Thumbnail | Sidecar::Clip => 120,
            Sidecar::Caption | Sidecar::Ocr => 180,
        })
    }
}

#[derive(Debug, Clone)]
pub struct Sidecars {
    http: reqwest::Client,
    host: String,
}

impl Sidecars {
    pub fn new(http: reqwest::Client, host: impl Into<String>) -> Self {
        Sidecars {
            http,
            host: host.into(),
        }
    }

    pub fn url(&self, sidecar: Sidecar, path: &str) -> String {
        format!("http://{}:{}{}", self.host, sidecar.port(), path)
    }

    pub fn http(&self) -> &reqwest::Client {
        &self.http
    }
}
