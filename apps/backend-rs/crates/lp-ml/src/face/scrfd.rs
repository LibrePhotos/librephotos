//! insightface's SCRFD detector (`model_zoo/retinaface.py`, `RetinaFace`),
//! float32 throughout like the numpy code.

use anyhow::{Context, anyhow, bail};
use ort::session::Session;
use ort::value::Tensor;

use crate::preprocess::cv2;

pub const NMS_THRESH: f32 = 0.4;
pub const DET_THRESH: f32 = 0.5;
pub const INPUT_MEAN: f32 = 127.5;
pub const INPUT_STD: f32 = 128.0;

/// One detected face in image coordinates.
#[derive(Debug, Clone, PartialEq)]
pub struct Detection {
    /// `[x1, y1, x2, y2]`.
    pub bbox: [f32; 4],
    pub score: f32,
    pub kps: Option<[[f32; 2]; 5]>,
}

pub struct Scrfd {
    session: Session,
    /// `(width, height)`: fixed by the model, else `det_size`.
    input_size: (usize, usize),
    fmc: usize,
    strides: Vec<usize>,
    num_anchors: usize,
    use_kps: bool,
}

impl Scrfd {
    /// `RetinaFace._init_vars` + `prepare(input_size=det_size)`.
    pub fn new(
        session: Session,
        info: &super::onnx_meta::ModelInfo,
        det_size: (usize, usize),
    ) -> anyhow::Result<Self> {
        let outputs = session.outputs().len();
        let (fmc, strides, num_anchors, use_kps) = match outputs {
            6 => (3, vec![8, 16, 32], 2, false),
            9 => (3, vec![8, 16, 32], 2, true),
            10 => (5, vec![8, 16, 32, 64, 128], 1, false),
            15 => (5, vec![8, 16, 32, 64, 128], 1, true),
            n => bail!("unsupported detector with {n} outputs"),
        };
        let input_size = match (info.input_dim(2), info.input_dim(3)) {
            (Some(h), Some(w)) if h > 0 && w > 0 => (w as usize, h as usize),
            _ => det_size,
        };
        Ok(Scrfd {
            session,
            input_size,
            fmc,
            strides,
            num_anchors,
            use_kps,
        })
    }

    /// `detect(img, max_num=0)` on an RGB image (fed as-is into the BGR
    /// API, like the sidecar does).
    pub fn detect(&mut self, rgb: &[u8], w: usize, h: usize) -> anyhow::Result<Vec<Detection>> {
        let (in_w, in_h) = self.input_size;
        let im_ratio = h as f64 / w as f64;
        let model_ratio = in_h as f64 / in_w as f64;
        let (new_w, new_h) = if im_ratio > model_ratio {
            ((in_h as f64 / im_ratio) as usize, in_h)
        } else {
            (in_w, (in_w as f64 * im_ratio) as usize)
        };
        if new_w == 0 || new_h == 0 {
            bail!("image {w}x{h} is too narrow to detect faces in");
        }
        let det_scale = (new_h as f64 / h as f64) as f32;
        let resized = cv2::resize_linear(rgb, w, h, 3, new_w, new_h);
        let mut det_img = vec![0u8; in_w * in_h * 3];
        for y in 0..new_h {
            det_img[y * in_w * 3..y * in_w * 3 + new_w * 3]
                .copy_from_slice(&resized[y * new_w * 3..(y + 1) * new_w * 3]);
        }
        let blob = blob_bgr_swapped(&det_img, in_w, in_h, INPUT_MEAN, INPUT_STD);

        let (scores, bboxes, kpss) = self.forward(blob, in_w, in_h)?;
        let bboxes: Vec<[f32; 4]> = bboxes.iter().map(|b| b.map(|v| v / det_scale)).collect();
        let kpss: Vec<[[f32; 2]; 5]> = kpss
            .iter()
            .map(|k| k.map(|p| p.map(|v| v / det_scale)))
            .collect();

        let order = argsort_desc(&scores);
        let pre: Vec<(usize, [f32; 4], f32)> =
            order.iter().map(|&i| (i, bboxes[i], scores[i])).collect();
        let keep = nms(&pre, NMS_THRESH);
        Ok(keep
            .into_iter()
            .map(|k| {
                let (i, bbox, score) = pre[k];
                Detection {
                    bbox,
                    score,
                    kps: self.use_kps.then(|| kpss[i]),
                }
            })
            .collect())
    }

    #[allow(clippy::type_complexity)]
    fn forward(
        &mut self,
        blob: Vec<f32>,
        in_w: usize,
        in_h: usize,
    ) -> anyhow::Result<(Vec<f32>, Vec<[f32; 4]>, Vec<[[f32; 2]; 5]>)> {
        let input = Tensor::from_array(([1usize, 3, in_h, in_w], blob))?;
        let outs = self.session.run(ort::inputs![input])?;
        let mut scores_all = Vec::new();
        let mut bboxes_all = Vec::new();
        let mut kpss_all = Vec::new();
        let fmc = self.fmc;
        for (idx, &stride) in self.strides.iter().enumerate() {
            let (_, scores) = outs[idx]
                .try_extract_tensor::<f32>()
                .context("detector scores")?;
            let (_, bbox_preds) = outs[idx + fmc]
                .try_extract_tensor::<f32>()
                .context("detector boxes")?;
            let kps_preds = if self.use_kps {
                Some(
                    outs[idx + fmc * 2]
                        .try_extract_tensor::<f32>()
                        .context("detector landmarks")?
                        .1,
                )
            } else {
                None
            };
            let height = in_h / stride;
            let width = in_w / stride;
            let n = height * width * self.num_anchors;
            if scores.len() < n || bbox_preds.len() < n * 4 {
                return Err(anyhow!(
                    "detector output for stride {stride} has {} scores, expected {n}",
                    scores.len()
                ));
            }
            if let Some(k) = kps_preds
                && k.len() < n * 10
            {
                bail!("detector landmarks for stride {stride} are short");
            }
            let s = stride as f32;
            for (i, &score) in scores.iter().enumerate().take(n) {
                // numpy's `scores >= threshold` also drops NaN.
                if score.is_nan() || score < DET_THRESH {
                    continue;
                }
                let cell = i / self.num_anchors;
                let cx = ((cell % width) * stride) as f32;
                let cy = ((cell / width) * stride) as f32;
                let d = &bbox_preds[i * 4..i * 4 + 4];
                bboxes_all.push([cx - d[0] * s, cy - d[1] * s, cx + d[2] * s, cy + d[3] * s]);
                scores_all.push(score);
                if let Some(k) = kps_preds {
                    let k = &k[i * 10..i * 10 + 10];
                    let mut pts = [[0f32; 2]; 5];
                    for (j, p) in pts.iter_mut().enumerate() {
                        *p = [cx + k[2 * j] * s, cy + k[2 * j + 1] * s];
                    }
                    kpss_all.push(pts);
                }
            }
        }
        Ok((scores_all, bboxes_all, kpss_all))
    }
}

/// `cv2.dnn.blobFromImage(img, 1/std, size, (mean,)*3, swapRB=True)` on an
/// image of the right size: NCHW float32, channels reversed,
/// `(x - mean) * float32(1/std)`.
pub fn blob_bgr_swapped(pixels: &[u8], w: usize, h: usize, mean: f32, std: f32) -> Vec<f32> {
    let plane = w * h;
    let scale = (1.0f64 / std as f64) as f32;
    let mut out = vec![0f32; 3 * plane];
    for i in 0..plane {
        for c in 0..3 {
            out[c * plane + i] = (pixels[i * 3 + (2 - c)] as f32 - mean) * scale;
        }
    }
    out
}

/// `values.argsort()[::-1]` with a stable sort: descending, ties by
/// descending index.
pub fn argsort_desc(values: &[f32]) -> Vec<usize> {
    let mut idx: Vec<usize> = (0..values.len()).collect();
    idx.sort_by(|&a, &b| values[a].total_cmp(&values[b]));
    idx.reverse();
    idx
}

/// `RetinaFace.nms` over rows already sorted by score (the `+1` pixel areas
/// of the original). Returns row indices in keep order.
fn nms(dets: &[(usize, [f32; 4], f32)], thresh: f32) -> Vec<usize> {
    let scores: Vec<f32> = dets.iter().map(|d| d.2).collect();
    let area = |b: &[f32; 4]| (b[2] - b[0] + 1.0) * (b[3] - b[1] + 1.0);
    let areas: Vec<f32> = dets.iter().map(|d| area(&d.1)).collect();
    let mut order = argsort_desc(&scores);
    let mut keep = Vec::new();
    while let Some(&i) = order.first() {
        keep.push(i);
        let bi = dets[i].1;
        order = order[1..]
            .iter()
            .copied()
            .filter(|&j| {
                let bj = dets[j].1;
                let xx1 = bi[0].max(bj[0]);
                let yy1 = bi[1].max(bj[1]);
                let xx2 = bi[2].min(bj[2]);
                let yy2 = bi[3].min(bj[3]);
                let ww = 0f32.max(xx2 - xx1 + 1.0);
                let hh = 0f32.max(yy2 - yy1 + 1.0);
                let inter = ww * hh;
                let ovr = inter / (areas[i] + areas[j] - inter);
                ovr <= thresh
            })
            .collect();
    }
    keep
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn argsort_ties_reverse_index() {
        assert_eq!(argsort_desc(&[0.5, 0.9, 0.5, 0.7]), vec![1, 3, 2, 0]);
    }

    #[test]
    fn nms_drops_overlaps() {
        let d = vec![
            (0, [0.0, 0.0, 10.0, 10.0], 0.9),
            (1, [1.0, 1.0, 11.0, 11.0], 0.8),
            (2, [50.0, 50.0, 60.0, 60.0], 0.7),
        ];
        assert_eq!(nms(&d, 0.4), vec![0, 2]);
    }

    #[test]
    fn blob_swaps_and_scales() {
        let b = blob_bgr_swapped(&[255, 0, 128], 1, 1, 127.5, 128.0);
        assert_eq!(b, vec![0.5 / 128.0, -127.5 / 128.0, 127.5 / 128.0]);
    }
}
