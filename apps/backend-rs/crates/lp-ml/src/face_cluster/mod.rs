//! Face clustering and classification (`apps/backend-rs/sidecars/face_cluster`,
//! sidecar :8013; `api/face_classify.py` minus the ORM): HDBSCAN over the
//! encodings, two MLPClassifiers for train, 3-D PCA for the scatter plot.
//! Contract: `POST /cluster` [`ClusterRequest`] -> `{ids, labels}` (one label
//! per face), `POST /train` [`TrainRequest`] -> `{predictions}`, `POST /pca
//! {encodings}` -> `{coordinates}`. No model files.

mod inprocess;

pub use inprocess::InProcess;

use async_trait::async_trait;
use lp_sidecars::{ClusterReply, ClusterRequest, SidecarError, Sidecars, TrainReply, TrainRequest};

#[async_trait]
pub trait FaceClusterApi: Send + Sync {
    /// Must return exactly one label per requested face.
    async fn cluster(&self, req: &ClusterRequest) -> Result<ClusterReply, SidecarError>;

    async fn train(&self, req: &TrainRequest) -> Result<TrainReply, SidecarError>;

    /// 3-D PCA coordinates of the (hex) encodings, in order.
    async fn pca(&self, encodings: &[String]) -> Result<Vec<[f64; 3]>, SidecarError>;
}

#[async_trait]
impl FaceClusterApi for Sidecars {
    async fn cluster(&self, req: &ClusterRequest) -> Result<ClusterReply, SidecarError> {
        self.cluster_faces(req).await
    }

    async fn train(&self, req: &TrainRequest) -> Result<TrainReply, SidecarError> {
        self.train_faces(req).await
    }

    async fn pca(&self, encodings: &[String]) -> Result<Vec<[f64; 3]>, SidecarError> {
        self.face_pca(encodings).await
    }
}
