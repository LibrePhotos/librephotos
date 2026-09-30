//! In-process similarity index (port of `image_similarity/`). STUB.

use std::sync::Arc;

use async_trait::async_trait;
use lp_sidecars::{SidecarError, SimilarityBuild, SimilarityBuildReply, SimilaritySearchReply};
use serde_json::Value;

use super::SimilarityApi;
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

    /// No model: the index lives under `ctx.media_root()/similarity`.
    fn ready(&self) -> bool {
        true
    }
}

#[async_trait]
impl SimilarityApi for InProcess {
    async fn build(
        &self,
        _page: &SimilarityBuild<'_>,
    ) -> Result<SimilarityBuildReply, SidecarError> {
        Err(crate::not_implemented(Service::Similarity))
    }

    async fn search(
        &self,
        _user_id: i32,
        _embedding: &[f32],
        _n: Option<usize>,
        _threshold: f64,
    ) -> Result<SimilaritySearchReply, SidecarError> {
        Err(crate::not_implemented(Service::Similarity))
    }

    async fn delete(&self, _user_id: i32) -> Result<Value, SidecarError> {
        Err(crate::not_implemented(Service::Similarity))
    }
}
