//! In-process captions (port of `service/image_captioning/lfm2_vl.py`).
//!
//! Failures answer like the sidecar's 500 `{"error": ...}` (what Django's
//! `CaptionError` carries); a model that fails to load (e.g. the q4f16
//! `FastGelu` float16 kernel some CPU builds lack) is not kept, so the next
//! call tries again, as the sidecar drops a half-loaded captioner.

use std::path::Path;
use std::sync::Arc;

use async_trait::async_trait;
use lp_sidecars::SidecarError;

use super::CaptionApi;
use super::lfm2_vl::{self, Lfm2Vl};
use crate::{Backend, MlContext, ModelSlot, Service, models};

pub struct InProcess {
    ctx: Arc<MlContext>,
    slot: ModelSlot<Lfm2Vl>,
}

impl InProcess {
    /// Set to true once the port passes its goldens; `auto` mode then uses it.
    pub const IMPLEMENTED: bool = true;

    pub fn new(ctx: Arc<MlContext>) -> Self {
        let slot = ctx.slot(Service::Caption, lfm2_vl::MODEL_NAME);
        InProcess { ctx, slot }
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
        image_path: &str,
        prompt: Option<&str>,
    ) -> Result<String, SidecarError> {
        let dir = self
            .ctx
            .model_dir(lfm2_vl::MODEL_NAME)
            .unwrap_or_else(|| self.ctx.data_models().join(lfm2_vl::MODEL_NAME));
        if !self.ready() {
            return Err(crate::unavailable(
                Service::Caption,
                format!("the captioning model is not installed in {}", dir.display()),
            ));
        }
        let key = dir.display().to_string();
        let image = image_path.to_string();
        let prompt = prompt.map(str::to_string);
        self.slot
            .run(
                &key,
                move || Lfm2Vl::load(&dir),
                move |m| m.caption(Path::new(&image), prompt.as_deref()),
            )
            .await
            .map_err(|e| crate::failed_from(Service::Caption, e))
    }
}
