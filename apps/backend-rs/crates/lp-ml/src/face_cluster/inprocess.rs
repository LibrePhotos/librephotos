//! In-process clustering (port of the face_cluster sidecar). STUB.

use std::sync::Arc;

use async_trait::async_trait;
use lp_sidecars::{ClusterReply, ClusterRequest, SidecarError, TrainReply, TrainRequest};

use super::FaceClusterApi;
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

    /// Pure computation, no model files.
    fn ready(&self) -> bool {
        true
    }
}

#[async_trait]
impl FaceClusterApi for InProcess {
    async fn cluster(&self, _req: &ClusterRequest) -> Result<ClusterReply, SidecarError> {
        Err(crate::not_implemented(Service::FaceCluster))
    }

    async fn train(&self, _req: &TrainRequest) -> Result<TrainReply, SidecarError> {
        Err(crate::not_implemented(Service::FaceCluster))
    }

    async fn pca(&self, _encodings: &[String]) -> Result<Vec<[f64; 3]>, SidecarError> {
        Err(crate::not_implemented(Service::FaceCluster))
    }
}
