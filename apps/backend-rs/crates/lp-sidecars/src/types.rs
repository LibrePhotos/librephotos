//! Requests and replies per sidecar endpoint, and the typed calls.

use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{HEALTH_TIMEOUT, Sidecar, SidecarError, Sidecars, UNLOAD_TIMEOUT};

/// `(top, right, bottom, left)` in big-thumbnail pixels, as the face sidecar
/// and `Face.location_*` spell it.
pub type FaceBox = [i32; 4];

#[derive(Debug, Clone, PartialEq)]
pub struct DetectedFace {
    pub location: FaceBox,
    /// Sent along by current sidecars; `None` leaves it to `/face-encodings`.
    pub encoding: Option<Vec<f64>>,
}

#[derive(Debug, Deserialize)]
struct FaceLocationsReply {
    face_locations: Vec<Vec<f64>>,
    #[serde(default)]
    encodings: Option<Vec<Option<Vec<f64>>>>,
}

#[derive(Debug, Deserialize)]
struct FaceEncodingsReply {
    encodings: Vec<Option<Vec<f64>>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ClipEmbeddings {
    /// One slot per requested image; `None` for an image it could not read.
    pub imgs_emb: Vec<Option<Vec<f64>>>,
    pub magnitudes: Vec<Option<f64>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct QueryEmbedding {
    pub emb: Vec<f64>,
    pub magnitude: f64,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct OcrResult {
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub blocks: Option<Value>,
    #[serde(default)]
    pub image_width: Option<i64>,
    #[serde(default)]
    pub image_height: Option<i64>,
    #[serde(default)]
    pub mean_confidence: Option<f64>,
    #[serde(default)]
    pub text_area_fraction: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SimilarityBuild<'a> {
    pub user_id: i32,
    pub image_hashes: &'a [String],
    pub image_embeddings: &'a [Vec<f32>],
    pub begin: bool,
    pub commit: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SimilarityBuildReply {
    pub status: Value,
    #[serde(default)]
    pub index_size: Option<i64>,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SimilaritySearchReply {
    #[serde(default)]
    pub status: Option<bool>,
    #[serde(default)]
    pub result: Vec<Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClusterFace {
    pub id: i32,
    /// `Face.encoding` as stored (hex of float64 LE).
    pub encoding: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClusterRequest {
    pub faces: Vec<ClusterFace>,
    pub min_cluster_size: i32,
    pub min_samples: i32,
    pub cluster_selection_epsilon: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ClusterReply {
    pub ids: Vec<i32>,
    pub labels: Vec<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LabelledEncoding {
    pub person_id: i32,
    pub encoding: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TrainRequest {
    /// Person-labelled faces (the first classifier).
    pub known: Vec<LabelledEncoding>,
    /// CLUSTER persons' mean encodings, added for the cluster classifier.
    pub clusters: Vec<LabelledEncoding>,
    pub unknown: Vec<ClusterFace>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct FacePrediction {
    pub id: i32,
    pub cluster_person_id: i32,
    pub cluster_probability: f64,
    pub classification_person_id: Option<i32>,
    pub classification_probability: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TrainReply {
    pub predictions: Vec<FacePrediction>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Health {
    pub status: String,
    #[serde(default)]
    pub service: Option<String>,
    #[serde(default)]
    pub last_request_time: Option<f64>,
    #[serde(default)]
    pub model_loaded: Option<bool>,
    #[serde(default)]
    pub busy: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unload {
    Unloaded,
    /// 409: a request is still running.
    Busy,
}

impl Sidecars {
    /// `face_recognition.detect_faces`: every face with its encoding when
    /// the sidecar sent one (a count mismatch drops all of them).
    pub async fn detect_faces(
        &self,
        source: &str,
        model_name: &str,
    ) -> Result<Vec<DetectedFace>, SidecarError> {
        let reply: FaceLocationsReply = self
            .post_json(
                Sidecar::Face,
                "/face-locations",
                &serde_json::json!({"source": source, "model_name": model_name}),
            )
            .await?;
        let n = reply.face_locations.len();
        let encodings = reply
            .encodings
            .filter(|e| e.len() == n)
            .unwrap_or_else(|| vec![None; n]);
        reply
            .face_locations
            .into_iter()
            .zip(encodings)
            .map(|(loc, encoding)| {
                let location = face_box(&loc).ok_or_else(|| SidecarError::Body {
                    sidecar: Sidecar::Face.name(),
                    url: self.url(Sidecar::Face, "/face-locations"),
                    message: format!("bad face location {loc:?}"),
                })?;
                Ok(DetectedFace { location, encoding })
            })
            .collect()
    }

    /// `face_recognition.get_face_encodings`: one slot per location, `None`
    /// where the sidecar found no face there.
    pub async fn face_encodings(
        &self,
        source: &str,
        locations: &[FaceBox],
        model_name: &str,
    ) -> Result<Vec<Option<Vec<f64>>>, SidecarError> {
        let reply: FaceEncodingsReply = self
            .post_json(
                Sidecar::Face,
                "/face-encodings",
                &serde_json::json!({
                    "source": source,
                    "face_locations": locations,
                    "model_name": model_name,
                }),
            )
            .await?;
        Ok(reply.encodings)
    }

    /// `semantic_search.create_clip_embeddings`.
    pub async fn clip_embeddings(
        &self,
        imgs: &[String],
        model: &str,
    ) -> Result<ClipEmbeddings, SidecarError> {
        self.post_json(
            Sidecar::Clip,
            "/clip-embeddings",
            &serde_json::json!({"imgs": imgs, "model": model}),
        )
        .await
    }

    /// `semantic_search.calculate_query_embeddings`.
    pub async fn query_embeddings(
        &self,
        query: &str,
        model: &str,
    ) -> Result<QueryEmbedding, SidecarError> {
        self.post_json(
            Sidecar::Clip,
            "/query-embeddings",
            &serde_json::json!({"query": query, "model": model}),
        )
        .await
    }

    /// `image_captioning.generate_caption`: the caption, or an error carrying
    /// the sidecar's reason (`CaptionError`).
    pub async fn generate_caption(
        &self,
        image_path: &str,
        prompt: Option<&str>,
    ) -> Result<String, SidecarError> {
        let mut body = serde_json::json!({"image_path": image_path});
        if let Some(p) = prompt {
            body["prompt"] = Value::from(p);
        }
        let reply: Value = self
            .post_json(Sidecar::Caption, "/generate-caption", &body)
            .await?;
        match reply.get("caption") {
            Some(Value::String(s)) => Ok(s.clone()),
            Some(other) => Ok(other.to_string()),
            None => Err(SidecarError::Body {
                sidecar: Sidecar::Caption.name(),
                url: self.url(Sidecar::Caption, "/generate-caption"),
                message: reply
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("no caption in reply")
                    .to_string(),
            }),
        }
    }

    /// The tags sidecar's whole JSON reply (`{"tags": {...}}`).
    pub async fn generate_tags(
        &self,
        image_path: &str,
        confidence: f64,
        tagging_model: &str,
    ) -> Result<Value, SidecarError> {
        self.post_json(
            Sidecar::Tags,
            "/generate-tags",
            &serde_json::json!({
                "image_path": image_path,
                "confidence": confidence,
                "tagging_model": tagging_model,
            }),
        )
        .await
    }

    pub async fn ocr(
        &self,
        image_path: &str,
        min_confidence: f64,
    ) -> Result<OcrResult, SidecarError> {
        self.post_json(
            Sidecar::Ocr,
            "/ocr",
            &serde_json::json!({"image_path": image_path, "min_confidence": min_confidence}),
        )
        .await
    }

    /// One page of an index rebuild (`image_similarity._post_build_page`).
    pub async fn similarity_build(
        &self,
        page: &SimilarityBuild<'_>,
    ) -> Result<SimilarityBuildReply, SidecarError> {
        self.post_json(Sidecar::Similarity, "/build/", page).await
    }

    /// `image_similarity.search_similar_embedding` (`n` defaults to 100 in the sidecar).
    pub async fn similarity_search(
        &self,
        user_id: i32,
        embedding: &[f32],
        n: Option<usize>,
        threshold: f64,
    ) -> Result<SimilaritySearchReply, SidecarError> {
        let mut body = serde_json::json!({
            "user_id": user_id,
            "image_embedding": embedding,
            "threshold": threshold,
        });
        if let Some(n) = n {
            body["n"] = Value::from(n);
        }
        self.post_json(Sidecar::Similarity, "/search/", &body).await
    }

    pub async fn similarity_delete(&self, user_id: i32) -> Result<Value, SidecarError> {
        let bytes =
            serde_json::to_vec(&serde_json::json!({"user_id": user_id})).expect("serializable");
        let reply = self
            .call(
                Sidecar::Similarity,
                Method::DELETE,
                "/build/",
                Some(bytes),
                self.timeout(Sidecar::Similarity),
                true,
                &[],
            )
            .await?;
        self.parse(Sidecar::Similarity, "/build/", &reply.body)
    }

    /// RAW render through the thumbnail sidecar; returns the written path.
    pub async fn render_thumbnail(
        &self,
        source: &str,
        destination: &str,
        height: u32,
    ) -> Result<String, SidecarError> {
        let reply: Value = self
            .post_json(
                Sidecar::Thumbnail,
                "/",
                &serde_json::json!({"source": source, "destination": destination, "height": height}),
            )
            .await?;
        reply
            .get("thumbnail")
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| SidecarError::Body {
                sidecar: Sidecar::Thumbnail.name(),
                url: self.url(Sidecar::Thumbnail, "/"),
                message: "no thumbnail in reply".into(),
            })
    }

    pub async fn cluster_faces(&self, req: &ClusterRequest) -> Result<ClusterReply, SidecarError> {
        let reply: ClusterReply = self
            .post_json(Sidecar::FaceCluster, "/cluster", req)
            .await?;
        if reply.labels.len() != req.faces.len() {
            return Err(SidecarError::Body {
                sidecar: Sidecar::FaceCluster.name(),
                url: self.url(Sidecar::FaceCluster, "/cluster"),
                message: format!(
                    "{} labels for {} faces",
                    reply.labels.len(),
                    req.faces.len()
                ),
            });
        }
        Ok(reply)
    }

    pub async fn train_faces(&self, req: &TrainRequest) -> Result<TrainReply, SidecarError> {
        self.post_json(Sidecar::FaceCluster, "/train", req).await
    }

    /// 3-D PCA coordinates of the encodings (hex), in order.
    pub async fn face_pca(&self, encodings: &[String]) -> Result<Vec<[f64; 3]>, SidecarError> {
        #[derive(Deserialize)]
        struct Reply {
            coordinates: Vec<[f64; 3]>,
        }
        let reply: Reply = self
            .post_json(
                Sidecar::FaceCluster,
                "/pca",
                &serde_json::json!({"encodings": encodings}),
            )
            .await?;
        Ok(reply.coordinates)
    }

    /// `GET /health`, one attempt.
    pub async fn health(&self, sidecar: Sidecar) -> Result<Health, SidecarError> {
        let reply = self
            .call(
                sidecar,
                Method::GET,
                "/health",
                None,
                HEALTH_TIMEOUT,
                false,
                &[],
            )
            .await?;
        self.parse(sidecar, "/health", &reply.body)
    }

    /// `POST /unload-model`; a 409 means the sidecar is busy.
    pub async fn unload_model(&self, sidecar: Sidecar) -> Result<Unload, SidecarError> {
        let reply = self
            .call(
                sidecar,
                Method::POST,
                "/unload-model",
                None,
                UNLOAD_TIMEOUT,
                false,
                &[409],
            )
            .await?;
        Ok(if reply.status == 409 {
            Unload::Busy
        } else {
            Unload::Unloaded
        })
    }
}

fn face_box(loc: &[f64]) -> Option<FaceBox> {
    if loc.len() != 4 || loc.iter().any(|v| !v.is_finite()) {
        return None;
    }
    Some([loc[0] as i32, loc[1] as i32, loc[2] as i32, loc[3] as i32])
}
