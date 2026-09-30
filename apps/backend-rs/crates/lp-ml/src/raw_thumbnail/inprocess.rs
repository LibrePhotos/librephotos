//! In-process RAW rendering (port of `service/thumbnail`). STUB.

use std::sync::Arc;

use async_trait::async_trait;
use lp_sidecars::SidecarError;

use super::RawThumbnailApi;
use crate::{Backend, MlContext, Service};

pub struct InProcess {
    #[allow(dead_code)]
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

    /// No model files.
    fn ready(&self) -> bool {
        true
    }
}

#[async_trait]
impl RawThumbnailApi for InProcess {
    async fn render_thumbnail(
        &self,
        _source: &str,
        _destination: &str,
        _height: u32,
    ) -> Result<String, SidecarError> {
        Err(crate::not_implemented(Service::RawThumbnail))
    }
}
