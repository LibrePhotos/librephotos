//! In-process OCR (port of `service/ocr/ppocr`, see [`super::ppocr`]).

use std::path::{Path, PathBuf};
use std::sync::Arc;

use async_trait::async_trait;
use lp_sidecars::{OcrResult, SidecarError};

use super::OcrApi;
use super::ppocr::{DecodeError, Engine, Options, Prediction};
use crate::slot::ModelSlot;
use crate::{Backend, MlContext, Service, models};

pub struct InProcess {
    ctx: Arc<MlContext>,
    slot: ModelSlot<Engine>,
}

impl InProcess {
    /// Set to true once the port passes its goldens; `auto` mode then uses it.
    pub const IMPLEMENTED: bool = true;

    pub fn new(ctx: Arc<MlContext>) -> Self {
        let slot = ctx.slot(Service::Ocr, "ppocrv6");
        InProcess { ctx, slot }
    }

    /// The selected bundle's directory, or why OCR cannot run.
    fn bundle(&self) -> Result<(String, PathBuf), SidecarError> {
        let model = self.ctx.selection().ocr_model;
        if models::not_selected(&model) {
            return Err(crate::unavailable(Service::Ocr, "no OCR model selected"));
        }
        let Some(dir) = self.ctx.model_dir(&model) else {
            return Err(crate::unavailable(
                Service::Ocr,
                format!("unknown OCR model {model:?}"),
            ));
        };
        if !self.ctx.model_present(&model) {
            return Err(crate::unavailable(
                Service::Ocr,
                format!("OCR model {model} is not installed ({})", dir.display()),
            ));
        }
        Ok((model, dir))
    }

    /// The whole `/ocr` request: `min_confidence`, `max_side` and
    /// `det_only` as the sidecar takes them.
    pub async fn predict(
        &self,
        image_path: &str,
        opts: Options,
    ) -> Result<Prediction, SidecarError> {
        // A missing file is bad input, rejected before paying the model load.
        if !Path::new(image_path).is_file() {
            return Err(crate::bad_input(Service::Ocr, "Image not found"));
        }
        let (model, dir) = self.bundle()?;
        let path = PathBuf::from(image_path);
        let key = dir.display().to_string();
        let res = if crate::pipeline() {
            // Decode on a blocking thread (originals can be 20+ MP): the slot
            // only runs the models while the next photos decode.
            let decoded =
                tokio::task::spawn_blocking(move || super::ppocr::decode::read_image(&path))
                    .await
                    .map_err(|e| crate::failed(Service::Ocr, e.to_string()))?;
            let prepass = prepass_side();
            match decoded {
                Err(e) => Err(anyhow::Error::from(e)),
                Ok(img) => {
                    self.slot
                        .run(
                            &key,
                            move || Engine::load(&dir),
                            move |engine| match prepass {
                                Some(side) if !opts.det_only => {
                                    let (boxes, _) = engine.detect(&img, side)?;
                                    if boxes.is_empty() {
                                        // No text at the coarse size: an empty result.
                                        engine.finish(&img, &[], opts)
                                    } else {
                                        engine.predict_image(&img, opts)
                                    }
                                }
                                _ => engine.predict_image(&img, opts),
                            },
                        )
                        .await
                }
            }
        } else {
            self.slot
                .run(
                    &key,
                    move || Engine::load(&dir),
                    move |engine| engine.predict(&path, opts),
                )
                .await
        };
        res.map_err(|e| {
            if e.downcast_ref::<DecodeError>().is_some() {
                tracing::warn!(image = image_path, error = %e, "ocr: could not decode image");
                crate::bad_input(Service::Ocr, "Failed to decode image")
            } else {
                tracing::warn!(image = image_path, model = %model, error = %format!("{e:#}"), "ocr failed");
                crate::failed_from(Service::Ocr, e)
            }
        })
    }
}

/// `LP_OCR_PREPASS`: detection side of a cheap text check before full OCR
/// (pipelined path only). A photo whose detection at this side finds no
/// text box gets an empty result without the full-size detection and the
/// recognition. Unset or 0 = off (default).
pub fn prepass_side() -> Option<usize> {
    static SIDE: std::sync::OnceLock<Option<usize>> = std::sync::OnceLock::new();
    *SIDE.get_or_init(|| {
        std::env::var("LP_OCR_PREPASS")
            .ok()
            .and_then(|v| v.trim().parse::<usize>().ok())
            .filter(|n| *n >= 64)
    })
}

impl Backend for InProcess {
    fn implemented(&self) -> bool {
        Self::IMPLEMENTED
    }

    /// The selected OCR bundle is installed (none selected: not ready; the
    /// OCR jobs do not run then anyway).
    fn ready(&self) -> bool {
        let model = self.ctx.selection().ocr_model;
        !models::not_selected(&model) && self.ctx.model_present(&model)
    }
}

#[async_trait]
impl OcrApi for InProcess {
    async fn ocr(&self, image_path: &str, min_confidence: f64) -> Result<OcrResult, SidecarError> {
        let p = self
            .predict(
                image_path,
                Options {
                    min_confidence,
                    ..Options::default()
                },
            )
            .await?;
        Ok(OcrResult {
            text: Some(p.text.clone()),
            blocks: Some(serde_json::Value::Array(
                p.blocks.iter().map(|b| b.to_json()).collect(),
            )),
            image_width: Some(p.image_width as i64),
            image_height: Some(p.image_height as i64),
            mean_confidence: Some(p.mean_confidence),
            text_area_fraction: Some(p.text_area_fraction),
        })
    }
}
