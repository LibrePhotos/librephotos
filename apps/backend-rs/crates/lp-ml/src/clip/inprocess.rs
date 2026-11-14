//! In-process CLIP ViT-B/32 (port of `service/clip_embeddings/clip_onnx.py`):
//! the Xenova ONNX export (`vision_model.onnx`, `text_model.onnx`,
//! `tokenizer.json`). Embeddings stay unnormalised, as the sidecar returns
//! them; the magnitude goes next to each one.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{Context, anyhow};
use async_trait::async_trait;
use lp_sidecars::{ClipEmbeddings, QueryEmbedding, SidecarError};
use ort::session::Session;
use ort::value::Tensor;
use rayon::prelude::*;

use super::{ClipApi, SemanticModel};
use crate::preprocess::{self, CLIP_MEAN, CLIP_STD, Filter, Order, Scale, pil};
use crate::slot::ModelSlot;
use crate::tokenize::{self, Tokenizer};
use crate::{Backend, MlContext, Service};

pub const IMAGE_SIZE: u32 = 224;
pub const CONTEXT_LENGTH: usize = 77;
pub const IMAGE_BATCH_SIZE: usize = 32;

/// `prepare_image`: shortest-edge BICUBIC resize, centre crop 224, CLIP
/// mean/std, CHW f32.
pub fn prepare_image(path: &Path) -> anyhow::Result<Vec<f32>> {
    let img = preprocess::load_rgb(path)?;
    let crop = pil::resize_shortest_edge_center_crop(&img, IMAGE_SIZE, Filter::Bicubic);
    let s = IMAGE_SIZE as usize;
    Ok(preprocess::to_chw(
        crop.as_raw(),
        s,
        s,
        Order::Rgb,
        Scale::Div255,
        CLIP_MEAN,
        CLIP_STD,
    ))
}

/// `prepare_image` of the model `kind`: CLIP's above, or MobileCLIP-S2's
/// (shortest edge 256 BILINEAR, centre crop, 0..1), as the tagger does.
pub fn prepare_for(kind: SemanticModel, path: &Path) -> anyhow::Result<Vec<f32>> {
    match kind {
        SemanticModel::ClipVitB32 => prepare_image(path),
        SemanticModel::MobileClipS2 => Ok(crate::tags::tagger::prepare_image(
            crate::tags::tagger::Model::MobileClipS2,
            path,
        )?
        .1),
    }
}

fn image_size(kind: SemanticModel) -> usize {
    match kind {
        SemanticModel::ClipVitB32 => IMAGE_SIZE as usize,
        SemanticModel::MobileClipS2 => 256,
    }
}

/// The loaded model: the towers and the tokenizer. ViT-B/32 loads both
/// towers up front (as the sidecar does); MobileCLIP-S2 loads each on first
/// use, because its image tower normally runs in the tags slot and only the
/// text tower is needed here (queries).
pub struct Clip {
    kind: SemanticModel,
    dir: PathBuf,
    vision: Option<Session>,
    text: Option<Session>,
    tokenizer: Tokenizer,
}

impl Clip {
    pub fn load(model_dir: &Path) -> anyhow::Result<Clip> {
        let kind = SemanticModel::of_dir(model_dir);
        let mut clip = Clip {
            kind,
            dir: model_dir.to_path_buf(),
            vision: None,
            text: None,
            tokenizer: tokenize::load(&model_dir.join("tokenizer.json"))?,
        };
        if kind == SemanticModel::ClipVitB32 {
            clip.vision()?;
            clip.text()?;
        }
        Ok(clip)
    }

    pub fn kind(&self) -> SemanticModel {
        self.kind
    }

    fn vision(&mut self) -> anyhow::Result<&mut Session> {
        if self.vision.is_none() {
            self.vision = Some(crate::runtime::session(
                &self.dir.join("vision_model.onnx"),
            )?);
        }
        Ok(self.vision.as_mut().expect("just loaded"))
    }

    fn text(&mut self) -> anyhow::Result<&mut Session> {
        if self.text.is_none() {
            self.text = Some(crate::runtime::session(&self.dir.join("text_model.onnx"))?);
        }
        Ok(self.text.as_mut().expect("just loaded"))
    }

    /// One embedding per prepared image, in batches of 32.
    pub fn encode_pixels(&mut self, pixels: &[Vec<f32>]) -> anyhow::Result<Vec<Vec<f32>>> {
        let s = image_size(self.kind);
        let mut out = Vec::with_capacity(pixels.len());
        for batch in pixels.chunks(IMAGE_BATCH_SIZE) {
            let (shape, data) = preprocess::stack(batch, 3, s, s);
            let input = Tensor::from_array((shape, data))?;
            let outputs = crate::runtime::run(self.vision()?, ort::inputs![input])?;
            let (shape, data) = outputs[0].try_extract_tensor::<f32>()?;
            let dim = embedding_dim(shape, batch.len())?;
            out.extend(data.chunks_exact(dim).map(<[f32]>::to_vec));
        }
        Ok(out)
    }

    /// `encode_text`: token ids truncated to 77; ViT-B/32 unpadded,
    /// MobileCLIP-S2 padded with 0 to its fixed 77-token context.
    pub fn encode_text(&mut self, text: &str) -> anyhow::Result<Vec<f32>> {
        let mut ids = self.token_ids(text)?;
        if self.kind == SemanticModel::MobileClipS2 {
            ids.resize(CONTEXT_LENGTH, 0);
        }
        let n = ids.len();
        let input = Tensor::from_array(([1usize, n], ids))?;
        let outputs = crate::runtime::run(self.text()?, ort::inputs![input])?;
        let (shape, data) = outputs[0].try_extract_tensor::<f32>()?;
        let dim = embedding_dim(shape, 1)?;
        Ok(data[..dim].to_vec())
    }

    pub fn token_ids(&self, text: &str) -> anyhow::Result<Vec<i64>> {
        tokenize::encode_ids(&self.tokenizer, text, Some(CONTEXT_LENGTH))
    }
}

fn embedding_dim(shape: &ort::value::Shape, rows: usize) -> anyhow::Result<usize> {
    match shape.as_ref() {
        [n, d] if *n as usize == rows && *d > 0 => Ok(*d as usize),
        other => Err(anyhow!(
            "unexpected CLIP output shape {other:?} for {rows} inputs"
        )),
    }
}

pub struct InProcess {
    ctx: Arc<MlContext>,
    slot: ModelSlot<Clip>,
}

impl InProcess {
    /// Set to true once the port passes its goldens; `auto` mode then uses it.
    pub const IMPLEMENTED: bool = true;

    pub fn new(ctx: Arc<MlContext>) -> Self {
        let slot = ctx.slot(Service::Clip, "clip_vit_b32");
        InProcess { ctx, slot }
    }

    async fn run<R: Send + 'static>(
        &self,
        model: &str,
        f: impl FnOnce(&mut Clip) -> anyhow::Result<R> + Send + 'static,
    ) -> Result<R, SidecarError> {
        let dir = self.model_dir(model);
        if !dir.join("vision_model.onnx").is_file() {
            return Err(crate::unavailable(
                Service::Clip,
                format!("CLIP model missing under {}", dir.display()),
            ));
        }
        crate::runtime::init().map_err(|e| crate::unavailable(Service::Clip, e))?;
        let key = dir.display().to_string();
        self.slot
            .run(&key, move || Clip::load(&dir), f)
            .await
            .map_err(|e| crate::failed_from(Service::Clip, e))
    }

    /// The directory the caller names (`settings.CLIP_ROOT`), else the catalog's.
    fn model_dir(&self, model: &str) -> PathBuf {
        if model.trim().is_empty() {
            let name = SemanticModel::of(&self.ctx.selection().semantic_search_model).name();
            self.ctx
                .model_dir(name)
                .unwrap_or_else(|| self.ctx.data_models().join(name))
        } else {
            PathBuf::from(model)
        }
    }
}

impl Backend for InProcess {
    fn implemented(&self) -> bool {
        Self::IMPLEMENTED
    }

    fn ready(&self) -> bool {
        self.ctx
            .model_present(SemanticModel::of(&self.ctx.selection().semantic_search_model).name())
    }
}

#[async_trait]
impl ClipApi for InProcess {
    async fn image_embeddings(
        &self,
        imgs: &[String],
        model: &str,
    ) -> Result<ClipEmbeddings, SidecarError> {
        let paths: Vec<String> = imgs.to_vec();
        let kind = SemanticModel::of_dir(&self.model_dir(model));
        // Decoding is the bulk of the work for big thumbnails: all cores,
        // outside the model slot.
        let prepared: Vec<Option<Vec<f32>>> = tokio::task::spawn_blocking(move || {
            paths
                .par_iter()
                .map(|p| match prepare_for(kind, Path::new(p)) {
                    Ok(t) => Some(t),
                    Err(e) => {
                        tracing::warn!(path = %p, error = %format!("{e:#}"), "clip embeddings: skipping unreadable image");
                        None
                    }
                })
                .collect()
        })
        .await
        .context("preparing CLIP images")
        .map_err(|e| crate::failed_from(Service::Clip, e))?;

        let slots: Vec<usize> = (0..prepared.len())
            .filter(|&i| prepared[i].is_some())
            .collect();
        let pixels: Vec<Vec<f32>> = prepared.into_iter().flatten().collect();
        let n = imgs.len();
        let embeddings = if pixels.is_empty() {
            Vec::new()
        } else {
            self.run(model, move |clip| clip.encode_pixels(&pixels))
                .await?
        };
        let mut imgs_emb = vec![None; n];
        let mut magnitudes = vec![None; n];
        for (i, e) in slots.into_iter().zip(embeddings) {
            magnitudes[i] = Some(preprocess::l2_norm(&e));
            imgs_emb[i] = Some(e.into_iter().map(f64::from).collect());
        }
        Ok(ClipEmbeddings {
            imgs_emb,
            magnitudes,
        })
    }

    async fn query_embedding(
        &self,
        query: &str,
        model: &str,
    ) -> Result<QueryEmbedding, SidecarError> {
        let q = query.to_string();
        let e = self.run(model, move |clip| clip.encode_text(&q)).await?;
        Ok(QueryEmbedding {
            magnitude: preprocess::l2_norm(&e),
            emb: e.into_iter().map(f64::from).collect(),
        })
    }
}
