//! In-process OCR (port of `service/ocr/ppocr`). STUB.

use std::sync::Arc;

use async_trait::async_trait;
use lp_sidecars::{OcrResult, SidecarError};

use super::OcrApi;
use crate::{Backend, MlContext, Service, models};

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

    /// The selected OCR bundle is installed (none selected: not ready; the
    /// OCR jobs do not run then anyway).
    fn ready(&self) -> bool {
        let model = self.ctx.selection().ocr_model;
        !models::not_selected(&model) && self.ctx.model_present(&model)
    }
}

#[async_trait]
impl OcrApi for InProcess {
    async fn ocr(
        &self,
        _image_path: &str,
        _min_confidence: f64,
    ) -> Result<OcrResult, SidecarError> {
        Err(crate::not_implemented(Service::Ocr))
    }
}
