//! In-process tagging (port of `service/tags/{main,mobileclip,siglip2}.py`).
//!
//! One slot keyed by the model dir holds the selected tagger. Its text
//! embeddings come from `<model dir>/tag_embeddings.npy`, shared with the
//! Python sidecar; when that cache is missing or stale the first call builds
//! it with the text tower (tens of seconds, SigLIP 2's 1.1 GB text model the
//! longest) and writes it back, as the sidecar does on first use.

use std::path::Path;
use std::sync::Arc;

use async_trait::async_trait;
use lp_sidecars::SidecarError;
use serde_json::{Value, json};

use super::TagsApi;
use super::tagger::{MAX_TAGS, Model, Tagger, prepare_image};
use crate::{Backend, MlContext, ModelSlot, Service};

pub struct InProcess {
    ctx: Arc<MlContext>,
    slot: ModelSlot<Tagger>,
}

impl InProcess {
    /// Set to true once the port passes its goldens; `auto` mode then uses it.
    pub const IMPLEMENTED: bool = true;

    pub fn new(ctx: Arc<MlContext>) -> Self {
        let slot = ctx.slot(Service::Tags, "tagger");
        InProcess { ctx, slot }
    }
}

/// `tagging_model or DEFAULT_TAGGING_MODEL`.
fn model_name(tagging_model: &str) -> &str {
    if tagging_model.is_empty() {
        Model::DEFAULT.name()
    } else {
        tagging_model
    }
}

impl Backend for InProcess {
    fn implemented(&self) -> bool {
        Self::IMPLEMENTED
    }

    /// The tagging model the site settings select is installed.
    fn ready(&self) -> bool {
        let model = self.ctx.selection().tagging_model;
        self.ctx.model_present(model_name(&model))
    }
}

impl InProcess {
    /// Run `f` on the loaded tagger of `tagging_model`.
    async fn with_tagger<R: Send + 'static>(
        &self,
        tagging_model: &str,
        f: impl FnOnce(&mut Tagger, Model) -> anyhow::Result<R> + Send + 'static,
    ) -> Result<R, SidecarError> {
        let name = model_name(tagging_model);
        let Some(model) = Model::from_name(name) else {
            return Err(crate::bad_input(
                Service::Tags,
                format!("Unknown tagging model '{name}'"),
            ));
        };
        if !self.ctx.model_present(name) {
            return Err(crate::unavailable(
                Service::Tags,
                format!("the {name} model is not downloaded"),
            ));
        }
        let dir = self
            .ctx
            .model_dir(name)
            .ok_or_else(|| crate::unavailable(Service::Tags, format!("unknown model {name}")))?;
        let key = dir.display().to_string();
        self.slot
            .run(
                &key,
                move || Tagger::load(model, &dir),
                move |t| f(t, model),
            )
            .await
            .map_err(|e| crate::failed(Service::Tags, format!("Failed to process image: {e:#}")))
    }

    async fn predict(
        &self,
        image_path: &str,
        tagging_model: &str,
    ) -> Result<super::tagger::Prediction, SidecarError> {
        let image = image_path.to_string();
        if crate::pipeline()
            && let Some(model) = Model::from_name(model_name(tagging_model))
        {
            // Decode and resize on a blocking thread: the slot (and its ORT
            // threads) only runs the model, while the next photos prepare.
            let path = image.clone();
            let prepared =
                tokio::task::spawn_blocking(move || prepare_image(model, Path::new(&path)))
                    .await
                    .map_err(|e| crate::failed(Service::Tags, e.to_string()))?;
            let (size, pixels) = match prepared {
                Ok(p) => p,
                Err(e) => {
                    let e = crate::failed(Service::Tags, format!("Failed to process image: {e:#}"));
                    tracing::warn!(image = %image_path, error = %e, "tags: error processing image");
                    return Err(e);
                }
            };
            return self
                .with_tagger(tagging_model, move |t, model| {
                    t.predict_pixels(size, pixels, model.threshold(), MAX_TAGS)
                })
                .await
                .inspect_err(|e| {
                    tracing::warn!(image = %image_path, error = %e, "tags: error processing image");
                });
        }
        self.with_tagger(tagging_model, move |t, model| {
            t.predict(Path::new(&image), model.threshold(), MAX_TAGS)
        })
        .await
        .inspect_err(|e| {
            tracing::warn!(image = %image_path, error = %e, "tags: error processing image");
        })
    }
}

#[async_trait]
impl TagsApi for InProcess {
    async fn generate_tags(
        &self,
        image_path: &str,
        _confidence: f64,
        tagging_model: &str,
    ) -> Result<Value, SidecarError> {
        let prediction = self.predict(image_path, tagging_model).await?;
        Ok(json!({ "tags": { "tags": prediction.tags } }))
    }

    async fn generate_tags_with_embedding(
        &self,
        image_path: &str,
        _confidence: f64,
        tagging_model: &str,
    ) -> Result<(Value, Vec<f32>), SidecarError> {
        let prediction = self.predict(image_path, tagging_model).await?;
        Ok((
            json!({ "tags": { "tags": prediction.tags } }),
            prediction.raw,
        ))
    }

    async fn image_embedding(
        &self,
        image_path: &str,
        tagging_model: &str,
    ) -> Result<Vec<f32>, SidecarError> {
        let image = image_path.to_string();
        self.with_tagger(tagging_model, move |t, _| {
            t.embed_image_raw(Path::new(&image))
        })
        .await
    }
}
