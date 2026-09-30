//! In-process tagging (port of `service/tags/{mobileclip,siglip2}`). STUB.

use std::sync::Arc;

use async_trait::async_trait;
use lp_sidecars::SidecarError;
use serde_json::Value;

use super::TagsApi;
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

    /// The tagging model the site settings select is installed.
    fn ready(&self) -> bool {
        let model = self.ctx.selection().tagging_model;
        let model = if model.trim().is_empty() {
            "mobileclip_s2".to_string()
        } else {
            model
        };
        self.ctx.model_present(&model)
    }
}

#[async_trait]
impl TagsApi for InProcess {
    async fn generate_tags(
        &self,
        _image_path: &str,
        _confidence: f64,
        _tagging_model: &str,
    ) -> Result<Value, SidecarError> {
        Err(crate::not_implemented(Service::Tags))
    }
}
