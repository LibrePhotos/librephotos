//! In-process faces (port of insightface detection + recognition). STUB.

use std::sync::Arc;

use async_trait::async_trait;
use lp_sidecars::{DetectedFace, FaceBox, SidecarError};

use super::FaceApi;
use crate::{Backend, MlContext, Service};

pub struct InProcess {
    ctx: Arc<MlContext>,
}

impl InProcess {
    /// Set to true once the port passes its goldens; `auto` mode then uses it.
    pub const IMPLEMENTED: bool = false;

    pub fn new(ctx: Arc<MlContext>) -> Self {
        InProcess { ctx }
    }
}

impl Backend for InProcess {
    fn implemented(&self) -> bool {
        Self::IMPLEMENTED
    }

    /// The selected face pack is installed (the sidecar falls back to
    /// `buffalo_sc` for an unknown name).
    fn ready(&self) -> bool {
        let model = self.ctx.selection().face_recognition_model;
        let known = [
            "antelopev2",
            "buffalo_l",
            "buffalo_m",
            "buffalo_s",
            "buffalo_sc",
        ];
        let model = if known.contains(&model.as_str()) {
            model.as_str()
        } else {
            "buffalo_sc"
        };
        self.ctx.model_present(model)
    }
}

#[async_trait]
impl FaceApi for InProcess {
    async fn detect_faces(
        &self,
        _source: &str,
        _model_name: &str,
    ) -> Result<Vec<DetectedFace>, SidecarError> {
        Err(crate::not_implemented(Service::Face))
    }

    async fn face_encodings(
        &self,
        _source: &str,
        _locations: &[FaceBox],
        _model_name: &str,
    ) -> Result<Vec<Option<Vec<f64>>>, SidecarError> {
        Err(crate::not_implemented(Service::Face))
    }
}
