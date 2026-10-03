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

use super::ClipApi;
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

/// The loaded model: both towers and the tokenizer.
pub struct Clip {
    vision: Session,
    text: Session,
    tokenizer: Tokenizer,
}

impl Clip {
    pub fn load(model_dir: &Path) -> anyhow::Result<Clip> {
        Ok(Clip {
            vision: crate::runtime::session(&model_dir.join("vision_model.onnx"))?,
            text: crate::runtime::session(&model_dir.join("text_model.onnx"))?,
            tokenizer: tokenize::load(&model_dir.join("tokenizer.json"))?,
        })
    }

    /// One embedding per prepared image, in batches of 32.
    pub fn encode_pixels(&mut self, pixels: &[Vec<f32>]) -> anyhow::Result<Vec<Vec<f32>>> {
        let s = IMAGE_SIZE as usize;
        let mut out = Vec::with_capacity(pixels.len());
        for batch in pixels.chunks(IMAGE_BATCH_SIZE) {
            let (shape, data) = preprocess::stack(batch, 3, s, s);
            let input = Tensor::from_array((shape, data))?;
            let outputs = self.vision.run(ort::inputs![input])?;
            let (shape, data) = outputs[0].try_extract_tensor::<f32>()?;
            let dim = embedding_dim(shape, batch.len())?;
            out.extend(data.chunks_exact(dim).map(<[f32]>::to_vec));
        }
        Ok(out)
    }

    /// `encode_text`: token ids truncated to 77, no padding.
    pub fn encode_text(&mut self, text: &str) -> anyhow::Result<Vec<f32>> {
        let ids = tokenize::encode_ids(&self.tokenizer, text, Some(CONTEXT_LENGTH))?;
        let n = ids.len();
        let input = Tensor::from_array(([1usize, n], ids))?;
        let outputs = self.text.run(ort::inputs![input])?;
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
            self.ctx
                .model_dir("clip_vit_b32")
                .unwrap_or_else(|| self.ctx.data_models().join("clip_vit_b32"))
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
        self.ctx.model_present("clip_vit_b32")
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
        // Decoding is the bulk of the work for big thumbnails: all cores,
        // outside the model slot.
        let prepared: Vec<Option<Vec<f32>>> = tokio::task::spawn_blocking(move || {
            paths
                .par_iter()
                .map(|p| match prepare_image(Path::new(p)) {
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
