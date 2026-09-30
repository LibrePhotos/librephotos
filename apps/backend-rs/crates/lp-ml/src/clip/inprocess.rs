//! In-process CLIP (port of `service/clip_embeddings/clip_onnx.py`). STUB.

use std::sync::Arc;

use async_trait::async_trait;
use lp_sidecars::{ClipEmbeddings, QueryEmbedding, SidecarError};

use super::ClipApi;
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

    fn ready(&self) -> bool {
        self.ctx.model_present("clip_vit_b32")
    }
}

#[async_trait]
impl ClipApi for InProcess {
    async fn image_embeddings(
        &self,
        _imgs: &[String],
        _model: &str,
    ) -> Result<ClipEmbeddings, SidecarError> {
        Err(crate::not_implemented(Service::Clip))
    }

    async fn query_embedding(
        &self,
        _query: &str,
        _model: &str,
    ) -> Result<QueryEmbedding, SidecarError> {
        Err(crate::not_implemented(Service::Clip))
    }
}
