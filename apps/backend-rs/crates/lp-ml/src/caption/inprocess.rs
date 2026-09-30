//! In-process captions (port of `service/image_captioning/lfm2_vl.py`). STUB.

use std::sync::Arc;

use async_trait::async_trait;
use lp_sidecars::SidecarError;

use super::CaptionApi;
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

    fn ready(&self) -> bool {
        models::captioning_model_exists(self.ctx.data_models())
    }
}

#[async_trait]
impl CaptionApi for InProcess {
    async fn generate_caption(
        &self,
        _image_path: &str,
        _prompt: Option<&str>,
    ) -> Result<String, SidecarError> {
        Err(crate::not_implemented(Service::Caption))
    }
}
