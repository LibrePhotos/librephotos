//! The zero-shot taggers of `service/tags` (`mobileclip/mobileclip.py`,
//! `siglip2/siglip2.py`): embed the photo with the image tower, compare it
//! with the cached text embeddings of every `"a photo of {tag}"` prompt, and
//! keep the best-scoring tags.
//!
//! The text tower only runs to build `<model dir>/tag_embeddings.npy` (the
//! same cache file the Python taggers write and read); it is dropped again
//! afterwards. MobileCLIP tokenises with its `tokenizer.json`, SigLIP 2 with
//! the sentencepiece `tokenizer.model` through [`super::spm`].

use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use anyhow::{Context, bail};
use ort::session::{Session, SessionInputValue};
use ort::value::Tensor;

use super::spm::SentencePiece;
use crate::preprocess::{self, Filter, Order, Scale, pil};

/// `service/tags/tags.txt` (kept identical by a test), stripped, blank lines dropped.
pub static TAGS: LazyLock<Vec<String>> = LazyLock::new(|| {
    include_str!("tags.txt")
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(str::to_string)
        .collect()
});

pub const PROMPT_TEMPLATE: &str = "a photo of ";
pub const CACHE_FILE: &str = "tag_embeddings.npy";
pub const MAX_TAGS: usize = 10;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Model {
    MobileClipS2,
    Siglip2,
}

impl Model {
    pub const DEFAULT: Model = Model::MobileClipS2;

    pub fn from_name(name: &str) -> Option<Model> {
        match name {
            "mobileclip_s2" => Some(Model::MobileClipS2),
            "siglip2" => Some(Model::Siglip2),
            _ => None,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Model::MobileClipS2 => "mobileclip_s2",
            Model::Siglip2 => "siglip2",
        }
    }

    /// `TAGGERS[model][1]`: MobileCLIP cuts on the softmax probability,
    /// SigLIP 2 on the raw cosine.
    pub fn threshold(self) -> f32 {
        match self {
            Model::MobileClipS2 => 0.02,
            Model::Siglip2 => 0.05,
        }
    }

    fn text_batch(self) -> usize {
        match self {
            Model::MobileClipS2 => 64,
            Model::Siglip2 => 32,
        }
    }

    /// Tokens per prompt (padded to exactly this).
    fn context_length(self) -> usize {
        match self {
            Model::MobileClipS2 => 77,
            Model::Siglip2 => 64,
        }
    }
}

/// `_stale_cache_reason`: why a cached embedding array cannot be used.
pub fn stale_cache_reason(model: Model, shape: &[usize], tag_count: usize) -> Option<String> {
    if shape.len() != 2 {
        return Some(format!("cache has wrong shape {shape:?}"));
    }
    if shape[0] != tag_count {
        return Some(format!(
            "cache has {} tags but tags.txt has {tag_count}",
            shape[0]
        ));
    }
    if model == Model::Siglip2 && shape[1] < 128 {
        return Some(format!(
            "cache has dim={} (likely stale from a failed build)",
            shape[1]
        ));
    }
    None
}

/// `_l2_normalize` of one row in place (f32, `max(norm, 1e-8)`).
fn l2_normalize(v: &mut [f32]) {
    let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt().max(1e-8);
    for x in v {
        *x /= norm;
    }
}

/// A 2-D f32 output with `rows` rows.
struct Matrix {
    shape: Vec<usize>,
    data: Vec<f32>,
}

/// `_select_pooled_output`: the first 2-D output with `rows` rows, else the
/// first output pooled (`_pool_embeddings`: 2-D as is, 3-D at the last
/// attended position, or position 0 without a mask).
fn select_pooled(
    outputs: &[Matrix],
    rows: usize,
    mask: Option<&[i64]>,
) -> anyhow::Result<Vec<f32>> {
    if let Some(m) = outputs
        .iter()
        .find(|m| m.shape.len() == 2 && m.shape[0] == rows)
    {
        return Ok(m.data.clone());
    }
    let first = outputs.first().context("the model has no outputs")?;
    match first.shape[..] {
        [_, _] => Ok(first.data.clone()),
        [b, seq, dim] => {
            let mut out = Vec::with_capacity(b * dim);
            for i in 0..b {
                let pos = match mask {
                    Some(mask) => {
                        let attended: i64 = mask[i * seq..(i + 1) * seq].iter().sum();
                        // numpy indexes -1 as the last position.
                        if attended > 0 {
                            attended as usize - 1
                        } else {
                            seq - 1
                        }
                    }
                    None => 0,
                };
                let at = (i * seq + pos) * dim;
                out.extend_from_slice(&first.data[at..at + dim]);
            }
            Ok(out)
        }
        _ => bail!("unexpected output shape {:?}", first.shape),
    }
}

fn run_outputs(
    session: &mut Session,
    inputs: Vec<(String, SessionInputValue<'_>)>,
) -> anyhow::Result<Vec<Matrix>> {
    let outputs = crate::runtime::run(session, inputs)?;
    let mut mats = Vec::with_capacity(outputs.len());
    for i in 0..outputs.len() {
        let (shape, data) = outputs[i].try_extract_tensor::<f32>()?;
        mats.push(Matrix {
            shape: shape.iter().map(|&d| d.max(0) as usize).collect(),
            data: data.to_vec(),
        });
    }
    Ok(mats)
}

fn input_names(session: &Session) -> Vec<String> {
    session
        .inputs()
        .iter()
        .map(|i| i.name().to_string())
        .collect()
}

/// `prepare_image`: the photo as a `[1, 3, S, S]` tensor.
pub fn prepare_image(model: Model, path: &Path) -> anyhow::Result<(usize, Vec<f32>)> {
    let img = preprocess::load_rgb(path)?;
    match model {
        Model::MobileClipS2 => {
            // Shortest edge 256 (BILINEAR), centre crop, 0..1, no mean/std.
            let img = pil::resize_shortest_edge_center_crop(&img, 256, Filter::Bilinear);
            Ok((
                256,
                preprocess::to_chw(
                    img.as_raw(),
                    256,
                    256,
                    Order::Rgb,
                    Scale::Div255,
                    [0.0; 3],
                    [1.0; 3],
                ),
            ))
        }
        Model::Siglip2 => {
            // Straight 384x384 BICUBIC, mean = std = 0.5.
            let img = pil::resize_rgb(&img, 384, 384, Filter::Bicubic);
            Ok((
                384,
                preprocess::to_chw(
                    img.as_raw(),
                    384,
                    384,
                    Order::Rgb,
                    Scale::Div255,
                    [0.5; 3],
                    [0.5; 3],
                ),
            ))
        }
    }
}

/// Prompt tokenisers.
enum TextTokenizer {
    Hf(Box<tokenizers::Tokenizer>),
    Spm(SentencePiece),
}

/// Token ids and attention mask of prompts, `[n, context_length]` each, as
/// the Python `_tokenize` pads them.
pub fn tokenize_prompts(
    model: Model,
    model_dir: &Path,
    prompts: &[String],
) -> anyhow::Result<(Vec<i64>, Vec<i64>)> {
    let tok = load_tokenizer(model, model_dir)?;
    tokenize_with(&tok, model, prompts)
}

fn load_tokenizer(model: Model, model_dir: &Path) -> anyhow::Result<TextTokenizer> {
    Ok(match model {
        Model::MobileClipS2 => TextTokenizer::Hf(Box::new(crate::tokenize::load(
            &model_dir.join("tokenizer.json"),
        )?)),
        Model::Siglip2 => {
            TextTokenizer::Spm(SentencePiece::load(&model_dir.join("tokenizer.model"))?)
        }
    })
}

fn tokenize_with(
    tok: &TextTokenizer,
    model: Model,
    prompts: &[String],
) -> anyhow::Result<(Vec<i64>, Vec<i64>)> {
    let len = model.context_length();
    let mut ids = Vec::with_capacity(prompts.len() * len);
    let mut mask = Vec::with_capacity(prompts.len() * len);
    for p in prompts {
        let mut row: Vec<i64> = match tok {
            // ids[:77] + [0] * (77 - len)
            TextTokenizer::Hf(t) => crate::tokenize::encode_ids(t, p, Some(len))?,
            // ids[:63] + [EOS=1], padded with 0
            TextTokenizer::Spm(sp) => {
                let mut r: Vec<i64> = sp
                    .encode(p)
                    .into_iter()
                    .take(len - 1)
                    .map(i64::from)
                    .collect();
                r.push(1);
                r
            }
        };
        let n = row.len();
        row.resize(len, 0);
        ids.extend_from_slice(&row);
        mask.extend((0..len).map(|i| i64::from(i < n)));
    }
    Ok((ids, mask))
}

/// `_build_tag_embeddings`: every prompt through the text tower, L2
/// normalised; returns `(dim, n x dim)`.
pub fn build_tag_embeddings(
    model: Model,
    model_dir: &Path,
    tags: &[String],
) -> anyhow::Result<(usize, Vec<f32>)> {
    tracing::info!(
        model = model.name(),
        tags = tags.len(),
        "building tag embeddings (first run only)"
    );
    let started = std::time::Instant::now();
    let tok = load_tokenizer(model, model_dir)?;
    let mut session = crate::runtime::session(&model_dir.join("text_model.onnx"))?;
    let names = input_names(&session);
    let prompts: Vec<String> = tags
        .iter()
        .map(|t| format!("{PROMPT_TEMPLATE}{t}"))
        .collect();
    let len = model.context_length();
    let mut all = Vec::new();
    let mut dim = 0;
    for batch in prompts.chunks(model.text_batch()) {
        let (ids, mask) = tokenize_with(&tok, model, batch)?;
        let n = batch.len();
        let mut feed: Vec<(String, SessionInputValue<'_>)> = vec![(
            names.first().context("text model has no inputs")?.clone(),
            Tensor::from_array(([n, len], ids))?.into(),
        )];
        if model == Model::Siglip2 && names.len() > 1 {
            feed.push((
                names[1].clone(),
                Tensor::from_array(([n, len], mask.clone()))?.into(),
            ));
        }
        let outputs = run_outputs(&mut session, feed)?;
        let mask = (model == Model::Siglip2).then_some(&mask[..]);
        let mut emb = select_pooled(&outputs, n, mask)?;
        dim = emb.len() / n;
        for row in emb.chunks_mut(dim) {
            l2_normalize(row);
        }
        all.extend_from_slice(&emb);
    }
    tracing::info!(
        model = model.name(),
        dim,
        secs = started.elapsed().as_secs_f64(),
        "tag embeddings built"
    );
    Ok((dim, all))
}

/// `_load_or_build_tag_embeddings`: the cache, rebuilt (and rewritten) when
/// missing or stale.
pub fn load_or_build_tag_embeddings(
    model: Model,
    model_dir: &Path,
) -> anyhow::Result<(usize, Vec<f32>)> {
    load_or_build_with(model, model_dir, || {
        build_tag_embeddings(model, model_dir, &TAGS)
    })
}

/// [`load_or_build_tag_embeddings`] with the text-tower build injected.
pub fn load_or_build_with(
    model: Model,
    model_dir: &Path,
    build: impl FnOnce() -> anyhow::Result<(usize, Vec<f32>)>,
) -> anyhow::Result<(usize, Vec<f32>)> {
    // With LP_ML_TAGS_CONCURRENCY > 1 several instances load at once; only
    // one may build (SigLIP 2's text tower alone is 1.1 GB), the others then
    // read its cache.
    static BUILD: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _build = BUILD.lock().unwrap_or_else(|e| e.into_inner());
    let cache = model_dir.join(CACHE_FILE);
    if cache.exists() {
        match super::npy::read_f32(&cache) {
            Ok((shape, data)) => match stale_cache_reason(model, &shape, TAGS.len()) {
                None => return Ok((shape[1], data)),
                Some(reason) => {
                    tracing::warn!(model = model.name(), %reason, "rebuilding tag embeddings")
                }
            },
            Err(e) => {
                tracing::warn!(model = model.name(), error = %format!("{e:#}"), "unreadable tag embeddings, rebuilding")
            }
        }
    }
    let (dim, data) = build()?;
    // A read-only model dir costs a rebuild per load, not the service.
    if let Err(e) = super::npy::write_f32(&cache, &[TAGS.len(), dim], &data) {
        tracing::warn!(model = model.name(), error = %format!("{e:#}"), "could not cache the tag embeddings");
    }
    Ok((dim, data))
}

/// A loaded tagger: the image tower and the tag embeddings.
pub struct Tagger {
    pub model: Model,
    pub model_dir: PathBuf,
    vision: Session,
    dim: usize,
    embeddings: Vec<f32>,
}

/// What a photo scored.
#[derive(Debug, Clone)]
pub struct Prediction {
    pub tags: Vec<String>,
    /// Per tag: the softmax probability (MobileCLIP) or cosine (SigLIP 2).
    pub scores: Vec<f32>,
    /// The L2-normalised image embedding.
    pub embedding: Vec<f32>,
    /// The image tower's output as is (what CLIP search stores).
    pub raw: Vec<f32>,
}

impl Tagger {
    pub fn load(model: Model, model_dir: &Path) -> anyhow::Result<Tagger> {
        let vision = crate::runtime::session(&model_dir.join("vision_model.onnx"))?;
        let (dim, embeddings) = load_or_build_tag_embeddings(model, model_dir)?;
        Ok(Tagger {
            model,
            model_dir: model_dir.to_path_buf(),
            vision,
            dim,
            embeddings,
        })
    }

    /// `embed_image`: the L2-normalised image embedding.
    pub fn embed_image(&mut self, path: &Path) -> anyhow::Result<Vec<f32>> {
        let mut emb = self.embed_image_raw(path)?;
        l2_normalize(&mut emb);
        Ok(emb)
    }

    /// The image tower's pooled output, not normalised.
    pub fn embed_image_raw(&mut self, path: &Path) -> anyhow::Result<Vec<f32>> {
        let (size, pixels) = prepare_image(self.model, path)?;
        let name = input_names(&self.vision)
            .into_iter()
            .next()
            .context("vision model has no inputs")?;
        let t = Tensor::from_array(([1usize, 3, size, size], pixels))?;
        let outputs = run_outputs(&mut self.vision, vec![(name, t.into())])?;
        let emb = select_pooled(&outputs, 1, None)?;
        if emb.len() != self.dim {
            bail!(
                "image embedding has {} values, the tag embeddings {}",
                emb.len(),
                self.dim
            );
        }
        Ok(emb)
    }

    /// `predict(image_path, threshold, max_tags)`.
    pub fn predict(
        &mut self,
        path: &Path,
        threshold: f32,
        max_tags: usize,
    ) -> anyhow::Result<Prediction> {
        let raw = self.embed_image_raw(path)?;
        let mut embedding = raw.clone();
        l2_normalize(&mut embedding);
        let mut scores: Vec<f32> = self
            .embeddings
            .chunks_exact(self.dim)
            .map(|t| t.iter().zip(&embedding).map(|(a, b)| a * b).sum())
            .collect();
        if self.model == Model::MobileClipS2 {
            softmax_scaled(&mut scores, 100.0);
        }
        let tags = top_tags(&scores, threshold, max_tags)
            .into_iter()
            .map(|i| TAGS[i].clone())
            .collect();
        Ok(Prediction {
            tags,
            scores,
            embedding,
            raw,
        })
    }
}

/// `_softmax(LOGIT_SCALE * similarities)` in f32.
fn softmax_scaled(v: &mut [f32], scale: f32) {
    for x in v.iter_mut() {
        *x *= scale;
    }
    let max = v.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    let mut sum = 0f64;
    for x in v.iter_mut() {
        *x = (*x - max).exp();
        sum += f64::from(*x);
    }
    let sum = sum as f32;
    for x in v.iter_mut() {
        *x /= sum;
    }
}

/// `_top_tags`: indices by descending score, stopping at the first one
/// under `threshold` or after `max_tags`.
pub fn top_tags(scores: &[f32], threshold: f32, max_tags: usize) -> Vec<usize> {
    let mut order: Vec<usize> = (0..scores.len()).collect();
    order.sort_by(|&a, &b| scores[b].total_cmp(&scores[a]));
    order
        .into_iter()
        .take_while(|&i| scores[i] >= threshold)
        .take(max_tags)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tags_match_the_python_vocabulary() {
        let python =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../backend/service/tags/tags.txt");
        let Ok(text) = std::fs::read_to_string(&python) else {
            eprintln!("{} missing; skipping", python.display());
            return;
        };
        let want: Vec<&str> = text
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .collect();
        assert_eq!(TAGS.iter().map(String::as_str).collect::<Vec<_>>(), want);
        assert_eq!(TAGS.len(), 938);
    }

    #[test]
    fn top_tags_cut_at_threshold_and_max() {
        let s = [0.1, 0.5, 0.01, 0.3, 0.2];
        assert_eq!(top_tags(&s, 0.15, 10), vec![1, 3, 4]);
        assert_eq!(top_tags(&s, 0.0, 2), vec![1, 3]);
        assert!(top_tags(&s, 0.9, 10).is_empty());
    }

    #[test]
    fn softmax_sums_to_one() {
        let mut v = vec![0.2, 0.25, 0.1];
        softmax_scaled(&mut v, 100.0);
        assert!((v.iter().sum::<f32>() - 1.0).abs() < 1e-6);
        assert!(v[1] > v[0] && v[0] > v[2]);
    }

    #[test]
    fn stale_caches() {
        assert!(stale_cache_reason(Model::Siglip2, &[938, 768], 938).is_none());
        assert!(stale_cache_reason(Model::Siglip2, &[938, 64], 938).is_some());
        assert!(stale_cache_reason(Model::MobileClipS2, &[938, 64], 938).is_none());
        assert!(stale_cache_reason(Model::MobileClipS2, &[900, 512], 938).is_some());
        assert!(stale_cache_reason(Model::MobileClipS2, &[938], 938).is_some());
    }

    fn fake_build(dim: usize) -> anyhow::Result<(usize, Vec<f32>)> {
        Ok((dim, (0..TAGS.len() * dim).map(|i| i as f32).collect()))
    }

    #[test]
    fn cache_is_built_once_then_read() {
        let dir = tempfile::tempdir().unwrap();
        let m = Model::MobileClipS2;
        let built = load_or_build_with(m, dir.path(), || fake_build(4)).unwrap();
        assert!(dir.path().join(CACHE_FILE).exists());
        let read = load_or_build_with(m, dir.path(), || panic!("cache ignored")).unwrap();
        assert_eq!(read, built);
        // A stale cache (other tag count) is rebuilt and replaced.
        crate::tags::npy::write_f32(&dir.path().join(CACHE_FILE), &[2, 4], &[0.0; 8]).unwrap();
        assert_eq!(
            load_or_build_with(m, dir.path(), || fake_build(4)).unwrap(),
            built
        );
        // SigLIP 2 also rejects a tiny dim left by a failed build.
        assert_eq!(
            load_or_build_with(Model::Siglip2, dir.path(), || fake_build(128))
                .unwrap()
                .0,
            128
        );
    }

    #[test]
    fn unwritable_cache_still_serves_the_embeddings() {
        let dir = tempfile::tempdir().unwrap();
        // A directory where the file should be: unreadable and unwritable.
        std::fs::create_dir(dir.path().join(CACHE_FILE)).unwrap();
        let (dim, data) =
            load_or_build_with(Model::MobileClipS2, dir.path(), || fake_build(3)).unwrap();
        assert_eq!((dim, data.len()), (3, TAGS.len() * 3));
    }

    #[test]
    fn concurrent_loads_build_once() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let dir = tempfile::tempdir().unwrap();
        let builds = AtomicUsize::new(0);
        std::thread::scope(|s| {
            for _ in 0..4 {
                s.spawn(|| {
                    load_or_build_with(Model::MobileClipS2, dir.path(), || {
                        builds.fetch_add(1, Ordering::SeqCst);
                        std::thread::sleep(std::time::Duration::from_millis(100));
                        fake_build(2)
                    })
                    .unwrap()
                });
            }
        });
        assert_eq!(builds.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn pooling_picks_2d_then_eos() {
        let hidden = Matrix {
            shape: vec![2, 3, 2],
            data: (0..12).map(|x| x as f32).collect(),
        };
        let pooled = Matrix {
            shape: vec![2, 2],
            data: vec![9.0; 4],
        };
        assert_eq!(
            select_pooled(&[hidden, pooled], 2, None).unwrap(),
            vec![9.0; 4]
        );
        let hidden = Matrix {
            shape: vec![2, 3, 2],
            data: (0..12).map(|x| x as f32).collect(),
        };
        let mask = [1, 1, 0, 1, 1, 1];
        assert_eq!(
            select_pooled(&[hidden], 2, Some(&mask)).unwrap(),
            vec![2.0, 3.0, 10.0, 11.0]
        );
    }
}
