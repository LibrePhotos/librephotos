//! In-process faces: a port of what the sidecar runs, insightface's
//! `FaceAnalysis(allowed_modules=["detection", "recognition"])` with
//! `det_size=(640, 640)` (SCRFD detection, Umeyama alignment, ArcFace).
//!
//! The sidecar hands `np.array(Image.open(src).convert("RGB"))` to
//! insightface, whose API expects BGR: both networks therefore see the
//! channels swapped. That is reproduced on purpose, so new embeddings keep
//! matching the ones already stored. Embeddings are not normalised.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{Context, anyhow, bail};
use async_trait::async_trait;
use image::RgbImage;
use lp_sidecars::{DetectedFace, FaceBox, SidecarError};
use ort::session::Session;
use ort::value::Tensor;

use super::FaceApi;
use super::align;
use super::onnx_meta::{self, ModelInfo};
use super::scrfd::{self, Detection, Scrfd};
use crate::slot::ModelSlot;
use crate::{Backend, MlContext, Service};

pub const DEFAULT_MODEL: &str = "buffalo_sc";
pub const SUPPORTED_MODELS: [&str; 5] = [
    "antelopev2",
    "buffalo_l",
    "buffalo_m",
    "buffalo_s",
    "buffalo_sc",
];
pub const DET_SIZE: (usize, usize) = (640, 640);
/// `MIN_FACE_MATCH_IOU`: how much a requested box must overlap a detected
/// face to take its embedding.
pub const MIN_FACE_MATCH_IOU: f64 = 0.3;

/// `_normalize_model_name`: unknown names fall back to `buffalo_sc`.
pub fn normalize_model_name(name: &str) -> &str {
    if SUPPORTED_MODELS.contains(&name) {
        name
    } else {
        DEFAULT_MODEL
    }
}

pub struct InProcess {
    ctx: Arc<MlContext>,
    slot: ModelSlot<FacePack>,
}

impl InProcess {
    /// Set to true once the port passes its goldens; `auto` mode then uses it.
    pub const IMPLEMENTED: bool = true;

    pub fn new(ctx: Arc<MlContext>) -> Self {
        let slot = ctx.slot::<FacePack>(Service::Face, "face_recognition");
        InProcess { ctx, slot }
    }

    fn pack_dir(&self, model: &str) -> Result<PathBuf, SidecarError> {
        if !self.ctx.model_present(model) {
            return Err(crate::unavailable(
                Service::Face,
                format!("face model {model} is not installed"),
            ));
        }
        self.ctx
            .model_dir(model)
            .ok_or_else(|| crate::unavailable(Service::Face, format!("unknown face model {model}")))
    }

    async fn analyze(
        &self,
        source: &str,
        model_name: &str,
        wanted: Want,
    ) -> Result<Vec<Face>, SidecarError> {
        let model = normalize_model_name(model_name).to_string();
        let dir = self.pack_dir(&model)?;
        if crate::runtime::init().is_err() {
            return Err(crate::unavailable(
                Service::Face,
                "ONNX Runtime is not available (set LP_ORT_LIB)",
            ));
        }
        let path = PathBuf::from(source);
        let image = tokio::task::spawn_blocking(move || crate::preprocess::load_rgb(&path))
            .await
            .map_err(|e| crate::failed(Service::Face, e.to_string()))?
            .map_err(|e| crate::failed_from(Service::Face, e))?;
        let key = dir.display().to_string();
        self.slot
            .run(
                &key,
                move || FacePack::load(&dir),
                move |pack| pack.analyze(&image, wanted),
            )
            .await
            .map_err(|e| crate::failed_from(Service::Face, e))
    }
}

impl Backend for InProcess {
    fn implemented(&self) -> bool {
        Self::IMPLEMENTED
    }

    /// The selected face pack is installed (the sidecar falls back to
    /// `buffalo_sc` for an unknown name).
    fn ready(&self) -> bool {
        let model = self.ctx.selection().face_recognition_model;
        self.ctx.model_present(normalize_model_name(&model))
    }
}

#[async_trait]
impl FaceApi for InProcess {
    async fn detect_faces(
        &self,
        source: &str,
        model_name: &str,
    ) -> Result<Vec<DetectedFace>, SidecarError> {
        let faces = self.analyze(source, model_name, Want::All).await?;
        Ok(faces
            .into_iter()
            .map(|f| DetectedFace {
                location: f.location,
                encoding: f.embedding.map(to_f64),
            })
            .collect())
    }

    async fn face_encodings(
        &self,
        source: &str,
        locations: &[FaceBox],
        model_name: &str,
    ) -> Result<Vec<Option<Vec<f64>>>, SidecarError> {
        let faces = self
            .analyze(source, model_name, Want::Matching(locations.to_vec()))
            .await?;
        let detected: Vec<FaceBox> = faces.iter().map(|f| f.location).collect();
        Ok(best_face_matches(locations, &detected)
            .into_iter()
            .map(|m| m.and_then(|i| faces[i].embedding.clone()).map(to_f64))
            .collect())
    }
}

fn to_f64(v: Vec<f32>) -> Vec<f64> {
    v.into_iter().map(f64::from).collect()
}

/// Which detected faces need an embedding.
#[derive(Debug, Clone)]
pub enum Want {
    All,
    /// Only those `_find_best_face_match` would pick for these boxes.
    Matching(Vec<FaceBox>),
}

/// A detected face: the sidecar's `(top, right, bottom, left)` box plus
/// insightface's float values.
#[derive(Debug, Clone)]
pub struct Face {
    pub location: FaceBox,
    pub detection: Detection,
    pub embedding: Option<Vec<f32>>,
}

/// `_to_face_location`: `int(round())` of the float32 box.
pub fn to_face_location(bbox: &[f32; 4]) -> FaceBox {
    let r = |v: f32| (v as f64).round_ties_even() as i32;
    [r(bbox[1]), r(bbox[2]), r(bbox[3]), r(bbox[0])]
}

/// `_iou` of two `(top, right, bottom, left)` boxes.
pub fn iou(a: &FaceBox, b: &FaceBox) -> f64 {
    let a = a.map(i64::from);
    let b = b.map(i64::from);
    let top = a[0].max(b[0]);
    let right = a[1].min(b[1]);
    let bottom = a[2].min(b[2]);
    let left = a[3].max(b[3]);
    let inter = (right - left).max(0) * (bottom - top).max(0);
    if inter == 0 {
        return 0.0;
    }
    let area = |x: [i64; 4]| (x[1] - x[3]) * (x[2] - x[0]);
    let union = area(a) + area(b) - inter;
    if union <= 0 {
        return 0.0;
    }
    inter as f64 / union as f64
}

/// `_find_best_face_match`: for each requested box in order, the index of
/// the not yet taken detected face with the highest IoU (>= 0.3; ties go to
/// the later face, as the sidecar's `>=` does), else `None`.
pub fn best_face_matches(requested: &[FaceBox], detected: &[FaceBox]) -> Vec<Option<usize>> {
    let mut remaining: Vec<usize> = (0..detected.len()).collect();
    requested
        .iter()
        .map(|loc| {
            let mut best = None;
            let mut best_score = MIN_FACE_MATCH_IOU;
            for &i in &remaining {
                let score = iou(loc, &detected[i]);
                if score >= best_score {
                    best_score = score;
                    best = Some(i);
                }
            }
            if let Some(i) = best {
                remaining.retain(|&r| r != i);
            }
            best
        })
        .collect()
}

/// `ArcFaceONNX`.
pub struct ArcFace {
    session: Session,
    /// Square input side (`input_size[0]`).
    size: usize,
    mean: f32,
    std: f32,
}

impl ArcFace {
    fn new(session: Session, info: &ModelInfo) -> anyhow::Result<Self> {
        // An MXNet export normalises inside the graph (Sub + Mul up front).
        let head = &info.first_nodes;
        let find_sub = head
            .iter()
            .any(|n| n.starts_with("Sub") || n.starts_with("_minus"));
        let find_mul = head
            .iter()
            .any(|n| n.starts_with("Mul") || n.starts_with("_mul"));
        let (mean, std) = if find_sub && find_mul {
            (0.0, 1.0)
        } else {
            (127.5, 127.5)
        };
        let size = info
            .input_dim(3)
            .filter(|n| *n > 0)
            .ok_or_else(|| anyhow!("recognition model has no fixed input size"))?
            as usize;
        if session.outputs().len() != 1 {
            bail!("recognition model must have one output");
        }
        Ok(ArcFace {
            session,
            size,
            mean,
            std,
        })
    }

    pub fn size(&self) -> usize {
        self.size
    }

    /// `get_feat` of one aligned crop (RGB, fed as BGR).
    pub fn embed(&mut self, crop: &[u8]) -> anyhow::Result<Vec<f32>> {
        let blob = scrfd::blob_bgr_swapped(crop, self.size, self.size, self.mean, self.std);
        let input = Tensor::from_array(([1usize, 3, self.size, self.size], blob))?;
        let outs = self.session.run(ort::inputs![input])?;
        let (_, data) = outs[0].try_extract_tensor::<f32>()?;
        Ok(data.to_vec())
    }
}

/// One face pack's models (what `FaceAnalysis` keeps).
pub struct FacePack {
    pub detector: Scrfd,
    pub recognizer: ArcFace,
}

/// insightface's `ModelRouter` task of a model file, from its graph.
fn task_of(info: &ModelInfo) -> Option<&'static str> {
    let d2 = info.input_dim(2);
    let d3 = info.input_dim(3);
    if info.outputs >= 5 {
        Some("detection")
    } else if d2 == Some(192) && d3 == Some(192) {
        Some("landmark")
    } else if d2 == Some(96) && d3 == Some(96) {
        Some("genderage")
    } else if info.inputs.len() == 2 && d2 == Some(128) && d3 == Some(128) {
        Some("inswapper")
    } else if let (Some(h), Some(w)) = (d2, d3)
        && h == w
        && h >= 112
        && h % 16 == 0
    {
        Some("recognition")
    } else {
        None
    }
}

impl FacePack {
    /// `FaceAnalysis(name, allowed_modules=["detection", "recognition"])`:
    /// the first detection and the first recognition model of the pack
    /// directory in sorted order; the rest is never loaded.
    pub fn load(dir: &Path) -> anyhow::Result<FacePack> {
        let mut files: Vec<PathBuf> = std::fs::read_dir(dir)
            .with_context(|| format!("reading {}", dir.display()))?
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.extension().is_some_and(|e| e == "onnx") && p.is_file())
            .collect();
        files.sort();
        let mut detection = None;
        let mut recognition = None;
        for f in files {
            let info = onnx_meta::read(&f)?;
            match task_of(&info) {
                Some("detection") if detection.is_none() => detection = Some((f, info)),
                Some("recognition") if recognition.is_none() => recognition = Some((f, info)),
                _ => {}
            }
        }
        let (det_path, det_info) =
            detection.ok_or_else(|| anyhow!("no detection model in {}", dir.display()))?;
        let (rec_path, rec_info) =
            recognition.ok_or_else(|| anyhow!("no recognition model in {}", dir.display()))?;
        let detector = Scrfd::new(crate::runtime::session(&det_path)?, &det_info, DET_SIZE)?;
        let recognizer = ArcFace::new(crate::runtime::session(&rec_path)?, &rec_info)?;
        Ok(FacePack {
            detector,
            recognizer,
        })
    }

    /// `FaceAnalysis.get(img)`, embedding the faces `wanted` asks for.
    pub fn analyze(&mut self, image: &RgbImage, wanted: Want) -> anyhow::Result<Vec<Face>> {
        let (w, h) = (image.width() as usize, image.height() as usize);
        let dets = self.detector.detect(image.as_raw(), w, h)?;
        let mut faces: Vec<Face> = dets
            .into_iter()
            .map(|d| Face {
                location: to_face_location(&d.bbox),
                detection: d,
                embedding: None,
            })
            .collect();
        let embed: Vec<bool> = match &wanted {
            Want::All => vec![true; faces.len()],
            Want::Matching(boxes) => {
                let detected: Vec<FaceBox> = faces.iter().map(|f| f.location).collect();
                let mut e = vec![false; faces.len()];
                for i in best_face_matches(boxes, &detected).into_iter().flatten() {
                    e[i] = true;
                }
                e
            }
        };
        for (face, needed) in faces.iter_mut().zip(embed) {
            if needed {
                let crop = self.align(image, &face.detection)?;
                face.embedding = Some(self.recognizer.embed(&crop)?);
            }
        }
        Ok(faces)
    }

    /// `face_align.norm_crop(img, landmark=face.kps, image_size)`.
    pub fn align(&self, image: &RgbImage, det: &Detection) -> anyhow::Result<Vec<u8>> {
        let kps = det
            .kps
            .as_ref()
            .ok_or_else(|| anyhow!("the detector gives no landmarks to align faces with"))?;
        let size = self.recognizer.size();
        let m = align::estimate_norm(kps, size)
            .ok_or_else(|| anyhow!("degenerate face landmarks {kps:?}"))?;
        Ok(align::warp_affine(
            image.as_raw(),
            image.width() as usize,
            image.height() as usize,
            &m,
            size,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn locations_round_half_even() {
        assert_eq!(to_face_location(&[10.5, 2.5, 20.5, 30.5]), [2, 20, 30, 10]);
    }

    #[test]
    fn matches_follow_the_sidecar() {
        let detected = [[0, 10, 10, 0], [0, 30, 10, 20], [0, 10, 10, 0]];
        // Equal IoU: the later face wins; a taken face is not handed out twice.
        let m = best_face_matches(&[[0, 10, 10, 0], [0, 10, 10, 0], [0, 10, 10, 0]], &detected);
        assert_eq!(m, vec![Some(2), Some(0), None]);
        assert_eq!(
            best_face_matches(&[[100, 110, 110, 100]], &detected),
            vec![None]
        );
        assert_eq!(
            best_face_matches(&[[0, 31, 11, 21]], &detected),
            vec![Some(1)]
        );
    }

    #[test]
    fn unknown_models_fall_back() {
        assert_eq!(normalize_model_name("buffalo_l"), "buffalo_l");
        assert_eq!(normalize_model_name("nope"), "buffalo_sc");
    }
}
