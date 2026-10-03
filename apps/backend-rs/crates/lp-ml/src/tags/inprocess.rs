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
use super::tagger::{MAX_TAGS, Model, Tagger};
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

#[async_trait]
impl TagsApi for InProcess {
    async fn generate_tags(
        &self,
        image_path: &str,
        _confidence: f64,
        tagging_model: &str,
    ) -> Result<Value, SidecarError> {
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
        let image = image_path.to_string();
        let prediction = self
            .slot
            .run(
                &key,
                move || Tagger::load(model, &dir),
                move |t| t.predict(Path::new(&image), model.threshold(), MAX_TAGS),
            )
            .await
            .map_err(|e| {
                tracing::warn!(image = %image_path, error = %format!("{e:#}"), "tags: error processing image");
                crate::failed(Service::Tags, format!("Failed to process image: {e:#}"))
            })?;
        Ok(json!({ "tags": { "tags": prediction.tags } }))
    }
}
