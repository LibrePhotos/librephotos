//! PP-OCRv6 (port of `service/ocr/ppocr`): DBNet detection, DB postprocess,
//! perspective crops, CRNN recognition with CTC greedy decoding, reading
//! order. The cv2 / pyclipper pieces are ported from their sources so boxes
//! and crops match the sidecar bit for bit (see the goldens in
//! `tests/ocr.rs`).

pub mod config;
pub mod contours;
pub mod decode;
pub mod hull;
pub mod poly;
pub mod warp;

use std::path::Path;

use anyhow::Context;
use ort::session::Session;
use ort::value::Tensor;
use serde_json::{Value, json};

pub use config::OcrConfig;
pub use decode::DecodeError;
use hull::Pts;
pub use warp::Image3;

use crate::preprocess::{self, Order, Scale};

/// minAreaRect boxes with a shorter side below this are discarded.
pub const MIN_BOX_SIDE: f32 = 3.0;
/// A block needs at least this many characters (after strip).
pub const MIN_BLOCK_CHARS: usize = 2;
pub const DEFAULT_MIN_CONFIDENCE: f64 = 0.6;
pub const REC_BATCH_SIZE: usize = 8;

/// A detected quad (TL, TR, BR, BL) in image coordinates.
pub type Quad = [[i32; 2]; 4];

/// `predict()`'s options.
#[derive(Debug, Clone, Copy)]
pub struct Options {
    pub min_confidence: f64,
    /// Detection input cap (`max_side`); `None` = the bundle's.
    pub max_side: Option<usize>,
    /// Detection only: no recognition, only the area signal.
    pub det_only: bool,
}

impl Default for Options {
    fn default() -> Self {
        Options {
            min_confidence: DEFAULT_MIN_CONFIDENCE,
            max_side: None,
            det_only: false,
        }
    }
}

/// Numpy's pairwise summation (`np.add.reduce` over float64).
pub fn np_sum(a: &[f64]) -> f64 {
    let n = a.len();
    if n < 8 {
        let mut r = 0.0;
        for x in a {
            r += x;
        }
        r
    } else if n <= 128 {
        let mut r = [0f64; 8];
        r.copy_from_slice(&a[..8]);
        let mut i = 8;
        while i < n - (n % 8) {
            for j in 0..8 {
                r[j] += a[i + j];
            }
            i += 8;
        }
        let mut res = ((r[0] + r[1]) + (r[2] + r[3])) + ((r[4] + r[5]) + (r[6] + r[7]));
        while i < n {
            res += a[i];
            i += 1;
        }
        res
    } else {
        let mut n2 = n / 2;
        n2 -= n2 % 8;
        np_sum(&a[..n2]) + np_sum(&a[n2..])
    }
}

pub fn np_mean(a: &[f64]) -> f64 {
    np_sum(a) / a.len() as f64
}

/// `round_up_to_multiple`.
pub fn round_up_to_multiple(value: i64, multiple: usize) -> usize {
    let m = multiple as i64;
    let v = value.max(1);
    let n = (v + m - 1) / m;
    (n * m).max(m) as usize
}

/// `compute_resize`: `(width, height)` of the detection input.
pub fn compute_resize(h: usize, w: usize, max_side: usize, multiple: usize) -> (usize, usize) {
    let longest = h.max(w);
    let ratio = if longest > max_side {
        max_side as f64 / longest as f64
    } else {
        1.0
    };
    let rh = (h as f64 * ratio).round_ties_even() as i64;
    let rw = (w as f64 * ratio).round_ties_even() as i64;
    (
        round_up_to_multiple(rw, multiple),
        round_up_to_multiple(rh, multiple),
    )
}

/// `quad_from_contour`: one contour through the DB reject gates.
pub fn quad_from_contour(
    contour: &[[i32; 2]],
    prob: &[f32],
    w: usize,
    h: usize,
    cfg: &OcrConfig,
) -> Option<[[f32; 2]; 4]> {
    let (points, sside) = hull::get_mini_boxes(&Pts::Int(contour));
    if sside < MIN_BOX_SIDE {
        return None;
    }
    if poly::box_score_fast(prob, w, h, &points) < cfg.det_box_thresh {
        return None;
    }
    let expanded = poly::unclip(&points, cfg.det_unclip_ratio)?;
    if expanded.len() < 4 {
        return None;
    }
    let pts: Vec<[f32; 2]> = expanded
        .iter()
        .map(|p| [p[0] as f32, p[1] as f32])
        .collect();
    let (quad, sside) = hull::get_mini_boxes(&Pts::Float(&pts));
    if sside < MIN_BOX_SIDE + 2.0 {
        return None;
    }
    Some(poly::order_points_clockwise(&quad))
}

/// `boxes_from_bitmap`: probability map -> quads in `dest` coordinates.
pub fn boxes_from_bitmap(
    prob: &[f32],
    w: usize,
    h: usize,
    cfg: &OcrConfig,
    dest: (usize, usize),
) -> Vec<Quad> {
    let bitmap: Vec<u8> = prob.iter().map(|&p| (p > cfg.det_thresh) as u8).collect();
    let contours = contours::find_contours(&bitmap, w, h);
    let n = contours.len().min(cfg.det_max_candidates);
    contours[..n]
        .iter()
        .filter_map(|c| quad_from_contour(c, prob, w, h, cfg))
        .map(|q| poly::rescale_quad(&q, (w, h), dest))
        .collect()
}

/// `resize_norm_img`: aspect-kept resize to the recognizer height, `[-1, 1]`
/// in BGR, zero-padded to its width. CHW f32.
pub fn resize_norm_img(img: &Image3, shape: [usize; 3]) -> Vec<f32> {
    let [c, ih, iw] = shape;
    let ratio = img.w as f64 / img.h.max(1) as f64;
    let want = (ih as f64 * ratio).ceil();
    let rw = if want > iw as f64 {
        iw
    } else {
        (want as usize).max(1)
    };
    let resized = preprocess::cv2::resize_linear(&img.data, img.w, img.h, 3, rw, ih);
    let t = preprocess::to_chw(
        &resized,
        rw,
        ih,
        Order::Bgr,
        Scale::Div255,
        [0.5; 3],
        [0.5; 3],
    );
    let mut out = vec![0f32; c * ih * iw];
    for ch in 0..c.min(3) {
        for y in 0..ih {
            let src = &t[ch * ih * rw + y * rw..ch * ih * rw + (y + 1) * rw];
            out[ch * ih * iw + y * iw..ch * ih * iw + y * iw + rw].copy_from_slice(src);
        }
    }
    out
}

/// `ctc_greedy_decode` of one `(T, C)` sequence.
pub fn ctc_greedy_decode(probs: &[f32], classes: usize, charset: &[String]) -> (String, f64) {
    let mut text = String::new();
    let mut confs: Vec<f64> = Vec::new();
    let mut previous: i64 = -1;
    for step in probs.chunks_exact(classes) {
        let mut best = 0usize;
        for (i, &v) in step.iter().enumerate() {
            if v > step[best] {
                best = i;
            }
        }
        let cls = best as i64;
        if cls == 0 {
            previous = cls;
            continue;
        }
        if cls == previous {
            continue;
        }
        previous = cls;
        if let Some(ch) = charset.get(best) {
            text.push_str(ch);
            confs.push(step[best] as f64);
        }
    }
    let conf = if confs.is_empty() {
        0.0
    } else {
        np_mean(&confs)
    };
    (text, conf)
}

/// Sum of the detected quads' areas over the image area, at most 1.
pub fn text_area_fraction(boxes: &[Quad], h: usize, w: usize) -> f64 {
    let area = h as f64 * w as f64;
    if area <= 0.0 {
        return 0.0;
    }
    let mut total = 0f64;
    for b in boxes {
        let pts: Vec<[f64; 2]> = b.iter().map(|p| [p[0] as f64, p[1] as f64]).collect();
        total += poly::polygon_area(&pts);
    }
    (total / area).min(1.0)
}

/// One recognised block.
#[derive(Debug, Clone, PartialEq)]
pub struct Block {
    pub text: String,
    pub quad: Quad,
    pub confidence: f64,
}

impl Block {
    pub fn to_json(&self) -> Value {
        json!({
            "text": self.text,
            "box": self.quad.iter().map(|p| json!([p[0], p[1]])).collect::<Vec<_>>(),
            "confidence": self.confidence,
        })
    }
}

/// `build_blocks`: confident blocks with at least two characters.
pub fn build_blocks(
    boxes: &[Quad],
    recognized: &[(String, f64)],
    min_confidence: f64,
) -> Vec<Block> {
    boxes
        .iter()
        .zip(recognized)
        .filter_map(|(q, (text, conf))| {
            let stripped = text.trim();
            if *conf < min_confidence || stripped.chars().count() < MIN_BLOCK_CHARS {
                return None;
            }
            Some(Block {
                text: stripped.to_string(),
                quad: *q,
                confidence: *conf,
            })
        })
        .collect()
}

pub fn mean_confidence(blocks: &[Block]) -> f64 {
    if blocks.is_empty() {
        return 0.0;
    }
    np_mean(&blocks.iter().map(|b| b.confidence).collect::<Vec<_>>())
}

/// `np.median`.
fn median(v: &[f64]) -> f64 {
    let mut s = v.to_vec();
    s.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let n = s.len();
    if n % 2 == 1 {
        s[n / 2]
    } else {
        // np.mean of the two middle values
        (s[n / 2 - 1] + s[n / 2]) / 2.0
    }
}

/// `reading_order_sort`: rows top to bottom (a block joins the first row
/// whose running centre is within half the median block height), blocks
/// left to right within a row.
pub fn reading_order_sort(blocks: Vec<Block>) -> Vec<Block> {
    if blocks.is_empty() {
        return blocks;
    }
    struct Item {
        block: Block,
        cy: f64,
        left: f64,
    }
    let mut heights = Vec::with_capacity(blocks.len());
    let mut items: Vec<Item> = blocks
        .into_iter()
        .map(|block| {
            let ys: Vec<f64> = block.quad.iter().map(|p| p[1] as f64).collect();
            let xs = block.quad.iter().map(|p| p[0] as f64);
            let cy = np_mean(&ys);
            let left = xs.fold(f64::INFINITY, f64::min);
            let max_y = ys.iter().copied().fold(f64::NEG_INFINITY, f64::max);
            let min_y = ys.iter().copied().fold(f64::INFINITY, f64::min);
            heights.push(max_y - min_y);
            Item { block, cy, left }
        })
        .collect();
    let tolerance = (median(&heights) * 0.5).max(1.0);
    items.sort_by(|a, b| a.cy.partial_cmp(&b.cy).unwrap_or(std::cmp::Ordering::Equal));
    struct Row {
        cy: f64,
        items: Vec<Item>,
    }
    let mut rows: Vec<Row> = Vec::new();
    for item in items {
        if let Some(row) = rows
            .iter_mut()
            .find(|r| (item.cy - r.cy).abs() <= tolerance)
        {
            row.items.push(item);
            row.cy = np_mean(&row.items.iter().map(|i| i.cy).collect::<Vec<_>>());
        } else {
            rows.push(Row {
                cy: item.cy,
                items: vec![item],
            });
        }
    }
    rows.sort_by(|a, b| a.cy.partial_cmp(&b.cy).unwrap_or(std::cmp::Ordering::Equal));
    let mut out = Vec::new();
    for mut row in rows {
        row.items.sort_by(|a, b| {
            a.left
                .partial_cmp(&b.left)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        out.extend(row.items.into_iter().map(|i| i.block));
    }
    out
}

/// What `predict` found. `blocks` is empty in det-only mode.
#[derive(Debug, Clone, PartialEq)]
pub struct Prediction {
    pub text: String,
    pub blocks: Vec<Block>,
    pub text_area_fraction: f64,
    pub mean_confidence: f64,
    pub box_count: usize,
    pub image_width: usize,
    pub image_height: usize,
    pub det_only: bool,
}

impl Prediction {
    /// The sidecar's JSON answer.
    pub fn to_json(&self) -> Value {
        if self.det_only {
            return json!({
                "text_area_fraction": self.text_area_fraction,
                "box_count": self.box_count,
                "image_width": self.image_width,
                "image_height": self.image_height,
            });
        }
        json!({
            "text": self.text,
            "blocks": self.blocks.iter().map(Block::to_json).collect::<Vec<_>>(),
            "text_area_fraction": self.text_area_fraction,
            "mean_confidence": self.mean_confidence,
            "image_width": self.image_width,
            "image_height": self.image_height,
        })
    }
}

/// A loaded bundle: config, both sessions and the decode table.
pub struct Engine {
    pub config: OcrConfig,
    det: Session,
    rec: Session,
    classes: usize,
    decode: Vec<String>,
}

impl Engine {
    /// Load a bundle and validate its charset against the recognizer.
    pub fn load(dir: &Path) -> anyhow::Result<Engine> {
        let config = OcrConfig::load(dir)?;
        let det = crate::runtime::session(&config.det_model())?;
        let rec = crate::runtime::session(&config.rec_model())?;
        let classes = rec
            .outputs()
            .first()
            .and_then(|o| o.dtype().tensor_shape().and_then(|s| s.last().copied()))
            .filter(|d| *d > 0)
            .context("recognition model output has no fixed class dimension")?
            as usize;
        let decode = config.decode_charset(classes)?;
        Ok(Engine {
            config,
            det,
            rec,
            classes,
            decode,
        })
    }

    /// `detect`: quads in `img` coordinates plus the detection input size.
    pub fn detect(
        &mut self,
        img: &Image3,
        max_side: usize,
    ) -> anyhow::Result<(Vec<Quad>, (usize, usize))> {
        let (prob, pw, ph) = self.prob_map(img, max_side)?;
        let size = compute_resize(img.h, img.w, max_side, self.config.det_size_multiple);
        Ok((
            boxes_from_bitmap(&prob, pw, ph, &self.config, (img.w, img.h)),
            size,
        ))
    }

    /// The detector's probability map `(map, width, height)`.
    pub fn prob_map(
        &mut self,
        img: &Image3,
        max_side: usize,
    ) -> anyhow::Result<(Vec<f32>, usize, usize)> {
        let cfg = &self.config;
        let (nw, nh) = compute_resize(img.h, img.w, max_side, cfg.det_size_multiple);
        let resized = preprocess::cv2::resize_linear(&img.data, img.w, img.h, 3, nw, nh);
        let order = if cfg.det_rgb { Order::Rgb } else { Order::Bgr };
        let x = preprocess::to_chw(
            &resized,
            nw,
            nh,
            order,
            Scale::Mul(cfg.det_scale),
            cfg.det_mean,
            cfg.det_std,
        );
        let input = Tensor::from_array(([1usize, 3, nh, nw], x))?;
        let out = self.det.run(ort::inputs![input])?;
        let (shape, prob) = out[0].try_extract_tensor::<f32>()?;
        let (ph, pw) = match shape[..] {
            [_, _, h, w] => (h as usize, w as usize),
            _ => anyhow::bail!("unexpected detection output shape {shape:?}"),
        };
        Ok((prob[..ph * pw].to_vec(), pw, ph))
    }

    /// `Recognizer.recognize`: `(text, confidence)` per crop, in input
    /// order, batched by aspect ratio.
    pub fn recognize(&mut self, crops: &[Image3]) -> anyhow::Result<Vec<(String, f64)>> {
        let n = crops.len();
        let mut results = vec![(String::new(), 0.0); n];
        let mut order: Vec<usize> = (0..n).collect();
        let aspect = |i: usize| crops[i].w as f64 / crops[i].h.max(1) as f64;
        order.sort_by(|&a, &b| {
            aspect(a)
                .partial_cmp(&aspect(b))
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        let shape = self.config.rec_input_shape;
        let [c, h, w] = shape;
        for batch in order.chunks(REC_BATCH_SIZE) {
            let tensors: Vec<Vec<f32>> = batch
                .iter()
                .map(|&i| resize_norm_img(&crops[i], shape))
                .collect();
            let (dims, data) = preprocess::stack(&tensors, c, h, w);
            let input = Tensor::from_array((dims, data))?;
            let out = self.rec.run(ort::inputs![input])?;
            let (oshape, probs) = out[0].try_extract_tensor::<f32>()?;
            let (t, classes) = match oshape[..] {
                [_, t, c] => (t as usize, c as usize),
                _ => anyhow::bail!("unexpected recognition output shape {oshape:?}"),
            };
            debug_assert_eq!(classes, self.classes);
            for (j, &orig) in batch.iter().enumerate() {
                let seq = &probs[j * t * classes..(j + 1) * t * classes];
                results[orig] = ctc_greedy_decode(seq, classes, &self.decode);
            }
        }
        Ok(results)
    }

    /// The whole pipeline on a decoded image.
    pub fn predict_image(&mut self, img: &Image3, opts: Options) -> anyhow::Result<Prediction> {
        let max_side = opts.max_side.unwrap_or(self.config.det_max_side);
        let (boxes, _) = self.detect(img, max_side)?;
        self.finish(img, &boxes, opts)
    }

    /// Everything after detection: area signal, crops, recognition,
    /// filtering and reading order.
    pub fn finish(
        &mut self,
        img: &Image3,
        boxes: &[Quad],
        opts: Options,
    ) -> anyhow::Result<Prediction> {
        let mut pred = Prediction {
            text: String::new(),
            blocks: Vec::new(),
            text_area_fraction: text_area_fraction(boxes, img.h, img.w),
            mean_confidence: 0.0,
            box_count: boxes.len(),
            image_width: img.w,
            image_height: img.h,
            det_only: opts.det_only,
        };
        if opts.det_only {
            return Ok(pred);
        }
        let crops: Vec<Image3> = boxes.iter().map(|q| warp::rotate_crop(img, q)).collect();
        let recognized = self.recognize(&crops)?;
        let blocks = reading_order_sort(build_blocks(boxes, &recognized, opts.min_confidence));
        pred.text = blocks
            .iter()
            .map(|b| b.text.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        pred.mean_confidence = mean_confidence(&blocks);
        pred.blocks = blocks;
        Ok(pred)
    }

    /// Read `path` and run the pipeline. A decode failure is a
    /// [`DecodeError`] in the chain.
    pub fn predict(&mut self, path: &Path, opts: Options) -> anyhow::Result<Prediction> {
        let img = decode::read_image(path)?;
        self.predict_image(&img, opts)
    }
}
