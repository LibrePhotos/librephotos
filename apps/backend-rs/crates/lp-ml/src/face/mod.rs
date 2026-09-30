//! Face detection + embeddings (`service/face_recognition`, sidecar :8005):
//! insightface `FaceAnalysis` (SCRFD detector + ArcFace recogniser) of the
//! selected pack (`buffalo_sc` default; `buffalo_s/m/l`, `antelopev2`),
//! `det_size=(640, 640)`. Contract: `POST /face-locations {source,
//! model_name}` -> `{face_locations: [(top, right, bottom, left)],
//! encodings}`; `POST /face-encodings {source, face_locations, model_name}`
//! -> `{encodings}` (one slot per box: the detected face with IoU >= 0.3,
//! else null). Boxes are `int(round())` of insightface's float bbox.

mod inprocess;

pub use inprocess::InProcess;

use async_trait::async_trait;
use lp_sidecars::{DetectedFace, FaceBox, SidecarError, Sidecars};

#[async_trait]
pub trait FaceApi: Send + Sync {
    async fn detect_faces(
        &self,
        source: &str,
        model_name: &str,
    ) -> Result<Vec<DetectedFace>, SidecarError>;

    async fn face_encodings(
        &self,
        source: &str,
        locations: &[FaceBox],
        model_name: &str,
    ) -> Result<Vec<Option<Vec<f64>>>, SidecarError>;
}

#[async_trait]
impl FaceApi for Sidecars {
    async fn detect_faces(
        &self,
        source: &str,
        model_name: &str,
    ) -> Result<Vec<DetectedFace>, SidecarError> {
        Sidecars::detect_faces(self, source, model_name).await
    }

    async fn face_encodings(
        &self,
        source: &str,
        locations: &[FaceBox],
        model_name: &str,
    ) -> Result<Vec<Option<Vec<f64>>>, SidecarError> {
        Sidecars::face_encodings(self, source, locations, model_name).await
    }
}
