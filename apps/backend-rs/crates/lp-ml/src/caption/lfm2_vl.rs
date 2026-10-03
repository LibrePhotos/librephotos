//! LFM2.5-VL-450M on ONNX Runtime, a port of `service/image_captioning/lfm2_vl.py`.
//!
//! Three graphs: the vision encoder (16x16 patches in, projected image tokens
//! out), the token embedding, and a merged decoder with a KV cache plus the
//! short convolution state of the LFM2 layers. Greedy decoding up to
//! `<|im_end|>` or 64 tokens. Preprocessing is the single-tile case of
//! transformers' `Lfm2VlImageProcessor`: smart-resize to a multiple of 32
//! within 64..=256 image tokens with Pillow's BILINEAR, mean/std 0.5, patches
//! flattened as (ph, pw, C).
//!
//! The cache dtype follows the decoder's `past_key_values.*` inputs (the q4
//! export keeps fp32, a q4f16 export fp16), and the `present*` outputs are
//! fed back as they come, so an fp16 cache never round-trips through f32.

use std::borrow::Cow;
use std::path::{Path, PathBuf};

use anyhow::{Context, anyhow, bail};
use ort::memory::Allocator;
use ort::session::{Session, SessionInputValue};
use ort::value::{DynTensor, DynValue, Tensor, TensorElementType, ValueType};
use tokenizers::Tokenizer;

use crate::preprocess::{self, pil};

pub const MODEL_NAME: &str = "lfm2_vl_450m";

const VISION_FILE: &str = "vision_encoder_q4.onnx";
const EMBED_FILE: &str = "embed_tokens_q4.onnx";
const DECODER_FILE: &str = "decoder_model_merged_q4.onnx";
const TOKENIZER_FILE: &str = "tokenizer.json";

const PATCH_SIZE: usize = 16;
const DOWNSAMPLE: usize = 2;
const RESIZE_FACTOR: f64 = (PATCH_SIZE * DOWNSAMPLE) as f64;
const MIN_IMAGE_TOKENS: f64 = 64.0;
const MAX_IMAGE_TOKENS: f64 = 256.0;
const MIN_PIXELS: f64 = MIN_IMAGE_TOKENS * RESIZE_FACTOR * RESIZE_FACTOR;
const MAX_PIXELS: f64 = MAX_IMAGE_TOKENS * RESIZE_FACTOR * RESIZE_FACTOR;
const IMAGE_MEAN: f32 = 0.5;
const IMAGE_STD: f32 = 0.5;

const BOS_TOKEN: &str = "<|startoftext|>";
const IMAGE_START: &str = "<|image_start|>";
const IMAGE_END: &str = "<|image_end|>";
const IMAGE_TOKEN: &str = "<image>";
const IMAGE_TOKEN_ID: u32 = 396;
/// `<|im_end|>`, the end of an assistant turn.
const IM_END_ID: i64 = 7;

pub const DEFAULT_PROMPT: &str = "Describe this image in a short, natural image caption.";
pub const DEFAULT_MAX_NEW_TOKENS: usize = 64;

/// `smart_resize(height, width)`: the (height, width) to resize to,
/// multiples of 32 within the image-token budget.
pub fn smart_resize(height: u32, width: u32) -> (u32, u32) {
    let (h, w) = (height as f64, width as f64);
    let f = RESIZE_FACTOR;
    let mut h_bar = f.max(pil::py_round(h / f) * f);
    let mut w_bar = f.max(pil::py_round(w / f) * f);
    if h_bar * w_bar > MAX_PIXELS {
        let beta = (h * w / MAX_PIXELS).sqrt();
        h_bar = f.max((h / beta / f).floor() * f);
        w_bar = f.max((w / beta / f).floor() * f);
    } else if h_bar * w_bar < MIN_PIXELS {
        let beta = (MIN_PIXELS / (h * w)).sqrt();
        h_bar = (h * beta / f).ceil() * f;
        w_bar = (w * beta / f).ceil() * f;
    }
    (h_bar as u32, w_bar as u32)
}

/// `prepare_image`'s tensors for one image.
#[derive(Debug, Clone)]
pub struct Patches {
    /// `(patches_h * patches_w) x 768`, row-major.
    pub pixel_values: Vec<f32>,
    pub patches_h: usize,
    pub patches_w: usize,
    /// The resized (width, height).
    pub resized: (u32, u32),
}

impl Patches {
    pub fn count(&self) -> usize {
        self.patches_h * self.patches_w
    }

    /// Image tokens the vision tower makes of these patches (2x2 pixel unshuffle).
    pub fn image_tokens(&self) -> usize {
        self.count() / (DOWNSAMPLE * DOWNSAMPLE)
    }
}

/// `prepare_image(image)`: resize, normalise, cut into patches.
pub fn prepare_image(img: &image::RgbImage) -> Patches {
    let (new_h, new_w) = smart_resize(img.height(), img.width());
    let resized = pil::resize_rgb(img, new_w, new_h, pil::Filter::Bilinear);
    let (w, h) = (new_w as usize, new_h as usize);
    let (ph, pw) = (h / PATCH_SIZE, w / PATCH_SIZE);
    let raw = resized.as_raw();
    let patch_len = PATCH_SIZE * PATCH_SIZE * 3;
    let mut out = Vec::with_capacity(ph * pw * patch_len);
    // (h, w, 3) -> (ph, 16, pw, 16, 3) -> (ph, pw, 16, 16, 3)
    for py in 0..ph {
        for px in 0..pw {
            for y in 0..PATCH_SIZE {
                let row = (py * PATCH_SIZE + y) * w + px * PATCH_SIZE;
                for &v in &raw[row * 3..(row + PATCH_SIZE) * 3] {
                    // numpy: (arr / 255.0 - 0.5) / 0.5, all in float32.
                    out.push((v as f32 / 255.0 - IMAGE_MEAN) / IMAGE_STD);
                }
            }
        }
    }
    Patches {
        pixel_values: out,
        patches_h: ph,
        patches_w: pw,
        resized: (new_w, new_h),
    }
}

/// `clean_caption`: strip the quotation marks the model wraps a caption in.
pub fn clean_caption(text: &str) -> String {
    let text = py_strip(text);
    let b = text.as_bytes();
    if b.len() >= 2 && b[0] == b[b.len() - 1] && (b[0] == b'"' || b[0] == b'\'') {
        return py_strip(&text[1..text.len() - 1]).to_string();
    }
    text.to_string()
}

/// `str.strip()`: Python's whitespace also covers the \x1c..\x1f separators.
fn py_strip(s: &str) -> &str {
    s.trim_matches(|c: char| c.is_whitespace() || ('\x1c'..='\x1f').contains(&c))
}

/// The chat-formatted prompt with `n_image` image slots.
pub fn prompt_text(n_image: usize, prompt: &str) -> String {
    format!(
        "{BOS_TOKEN}<|im_start|>user\n{IMAGE_START}{}{IMAGE_END}{prompt}<|im_end|>\n<|im_start|>assistant\n",
        IMAGE_TOKEN.repeat(n_image)
    )
}

/// One decoder cache input and how to make its empty value.
#[derive(Debug, Clone)]
struct CacheInput {
    name: String,
    /// Shape of the empty value (batch 1; KV sequence length 0).
    empty_shape: Vec<i64>,
}

/// What one caption produced (the test and benchmark hooks use the parts).
#[derive(Debug, Clone)]
pub struct Generated {
    pub caption: String,
    pub token_ids: Vec<i64>,
    pub prompt_ids: Vec<u32>,
    pub image_tokens: usize,
    /// The resized (width, height).
    pub resized: (u32, u32),
}

/// The loaded model: three sessions and the tokenizer.
pub struct Lfm2Vl {
    vision: Session,
    embed: Session,
    decoder: Session,
    tokenizer: Tokenizer,
    cache_inputs: Vec<CacheInput>,
    cache_dtype: TensorElementType,
    num_logits_to_keep: bool,
    output_names: Vec<String>,
}

fn dims(t: &ValueType) -> Option<(&TensorElementType, &[i64])> {
    match t {
        ValueType::Tensor { ty, shape, .. } => Some((ty, shape)),
        _ => None,
    }
}

impl Lfm2Vl {
    pub fn model_files(dir: &Path) -> [PathBuf; 4] {
        [
            dir.join(VISION_FILE),
            dir.join(EMBED_FILE),
            dir.join(DECODER_FILE),
            dir.join(TOKENIZER_FILE),
        ]
    }

    /// `Lfm2VlCaptioner.load()`.
    pub fn load(dir: &Path) -> anyhow::Result<Self> {
        let [vision, embed, decoder, tokenizer] = Self::model_files(dir);
        let vision = crate::runtime::session(&vision)?;
        let embed = crate::runtime::session(&embed)?;
        let decoder = crate::runtime::session(&decoder)?;
        let tokenizer = crate::tokenize::load(&tokenizer)?;

        let kv = decoder
            .inputs()
            .iter()
            .find(|i| i.name().starts_with("past_key_values."))
            .ok_or_else(|| anyhow!("{DECODER_FILE} has no past_key_values inputs"))?;
        let cache_dtype = match dims(kv.dtype()) {
            Some((TensorElementType::Float16, _)) => TensorElementType::Float16,
            _ => TensorElementType::Float32,
        };
        let mut cache_inputs = Vec::new();
        let mut num_logits_to_keep = false;
        for i in decoder.inputs() {
            let name = i.name();
            if name == "num_logits_to_keep" {
                num_logits_to_keep = true;
                continue;
            }
            let conv = name.starts_with("past_conv.");
            if !conv && !name.starts_with("past_key_values.") {
                continue;
            }
            let (_, shape) = dims(i.dtype())
                .filter(|(_, s)| s.len() == if conv { 3 } else { 4 })
                .ok_or_else(|| anyhow!("unexpected cache input {name}: {:?}", i.dtype()))?;
            let empty_shape = if conv {
                vec![1, shape[1], shape[2]]
            } else {
                vec![1, shape[1], 0, shape[3]]
            };
            if empty_shape.iter().any(|d| *d < 0) {
                bail!("cache input {name} has a dynamic head/channel dimension");
            }
            cache_inputs.push(CacheInput {
                name: name.to_string(),
                empty_shape,
            });
        }
        let output_names = decoder
            .outputs()
            .iter()
            .map(|o| o.name().to_string())
            .collect();
        Ok(Lfm2Vl {
            vision,
            embed,
            decoder,
            tokenizer,
            cache_inputs,
            cache_dtype,
            num_logits_to_keep,
            output_names,
        })
    }

    pub fn cache_dtype(&self) -> TensorElementType {
        self.cache_dtype
    }

    /// `_image_features`: the vision tower's `(image_tokens, hidden)` output.
    pub fn image_features(&mut self, patches: &Patches) -> anyhow::Result<(Vec<i64>, Vec<f32>)> {
        let n = patches.count();
        let pixel_values = Tensor::from_array((
            [1usize, n, PATCH_SIZE * PATCH_SIZE * 3],
            patches.pixel_values.clone(),
        ))?;
        let mask = Tensor::from_array(([1usize, n], vec![1i64; n]))?;
        let spatial = Tensor::from_array((
            [1usize, 2],
            vec![patches.patches_h as i64, patches.patches_w as i64],
        ))?;
        let out = self.vision.run(ort::inputs![
            "pixel_values" => pixel_values,
            "pixel_attention_mask" => mask,
            "spatial_shapes" => spatial,
        ])?;
        to_f32(&out[0]).context("image_features")
    }

    /// `_embed`: `(1, n, hidden)` embeddings of `ids`.
    fn embed_ids(&mut self, ids: Vec<i64>) -> anyhow::Result<(Vec<i64>, Vec<f32>)> {
        let n = ids.len();
        let input = Tensor::from_array(([1usize, n], ids))?;
        let out = self.embed.run(ort::inputs!["input_ids" => input])?;
        to_f32(&out[0]).context("inputs_embeds")
    }

    /// `_prompt_embeddings`: the prompt's embeddings with the image tokens
    /// swapped in; also the prompt ids.
    fn prompt_embeddings(
        &mut self,
        features: &[f32],
        n_image: usize,
        prompt: &str,
    ) -> anyhow::Result<(Vec<u32>, Tensor<f32>)> {
        let text = prompt_text(n_image, prompt);
        let enc = self
            .tokenizer
            .encode(text.as_str(), false)
            .map_err(|e| anyhow!("tokenizing the prompt: {e}"))?;
        let ids: Vec<u32> = enc.get_ids().to_vec();
        let (shape, mut embeds) = self.embed_ids(ids.iter().map(|&i| i as i64).collect())?;
        let hidden = *shape.last().unwrap_or(&0) as usize;
        let slots: Vec<usize> = ids
            .iter()
            .enumerate()
            .filter(|(_, t)| **t == IMAGE_TOKEN_ID)
            .map(|(i, _)| i)
            .collect();
        if slots.len() != n_image {
            bail!(
                "prompt carries {} image slots for {n_image} image tokens",
                slots.len()
            );
        }
        if features.len() != n_image * hidden {
            bail!(
                "image features have {} values for {n_image} x {hidden}",
                features.len()
            );
        }
        for (k, &slot) in slots.iter().enumerate() {
            embeds[slot * hidden..(slot + 1) * hidden]
                .copy_from_slice(&features[k * hidden..(k + 1) * hidden]);
        }
        let tensor = Tensor::from_array((shape, embeds))?;
        Ok((ids, tensor))
    }

    fn empty_cache(&self) -> anyhow::Result<Vec<(String, DynValue)>> {
        let alloc = Allocator::default();
        self.cache_inputs
            .iter()
            .map(|c| {
                let t = DynTensor::new(&alloc, self.cache_dtype, c.empty_shape.clone())?;
                Ok((c.name.clone(), t.into_dyn()))
            })
            .collect()
    }

    /// `_decode`: greedy decoding from the prompt embeddings.
    fn decode(&mut self, embeds: Tensor<f32>, max_new_tokens: usize) -> anyhow::Result<Vec<i64>> {
        let mut cache = self.empty_cache()?;
        let prompt_len = embeds.shape()[1] as usize;
        let mut current = embeds;
        let mut generated = Vec::new();
        for step in 0..max_new_tokens {
            let total = prompt_len + step;
            let mask = Tensor::from_array(([1usize, total], vec![1i64; total]))?;
            let mut feed: Vec<(Cow<'_, str>, SessionInputValue<'_>)> =
                Vec::with_capacity(cache.len() + 3);
            feed.push(("inputs_embeds".into(), (&current).into()));
            feed.push(("attention_mask".into(), mask.into()));
            if self.num_logits_to_keep {
                feed.push((
                    "num_logits_to_keep".into(),
                    Tensor::from_array(((), vec![1i64]))?.into(),
                ));
            }
            for (name, value) in &cache {
                feed.push((name.as_str().into(), value.into()));
            }
            let outputs = self.decoder.run(feed)?;
            let mut next_cache = Vec::with_capacity(cache.len());
            let mut logits = None;
            for (name, value) in outputs {
                if let Some(rest) = name.strip_prefix("present_conv.") {
                    next_cache.push((format!("past_conv.{rest}"), value));
                } else if let Some(rest) = name.strip_prefix("present.") {
                    next_cache.push((format!("past_key_values.{rest}"), value));
                } else if name == "logits" {
                    logits = Some(value);
                }
            }
            let logits = logits
                .ok_or_else(|| anyhow!("decoder has no logits output ({:?})", self.output_names))?;
            let next = last_row_argmax(&logits)?;
            // Python's `cache[past_name] = present`: replace in place, keep the
            // input order.
            for (name, value) in next_cache {
                if let Some(slot) = cache.iter_mut().find(|(n, _)| *n == name) {
                    slot.1 = value;
                } else {
                    cache.push((name, value));
                }
            }
            if next == IM_END_ID {
                break;
            }
            generated.push(next);
            let (shape, e) = self.embed_ids(vec![next])?;
            current = Tensor::from_array((shape, e))?;
        }
        Ok(generated)
    }

    /// `caption(image_path, prompt)` on a decoded image, with the parts.
    pub fn generate(
        &mut self,
        img: &image::RgbImage,
        prompt: &str,
        max_new_tokens: usize,
    ) -> anyhow::Result<Generated> {
        let patches = prepare_image(img);
        let (fshape, features) = self.image_features(&patches)?;
        let n_image = fshape.first().copied().unwrap_or(0) as usize;
        let (prompt_ids, embeds) = self.prompt_embeddings(&features, n_image, prompt)?;
        let token_ids = self.decode(embeds, max_new_tokens)?;
        let ids: Vec<u32> = token_ids.iter().map(|&i| i as u32).collect();
        let text = self
            .tokenizer
            .decode(&ids, true)
            .map_err(|e| anyhow!("decoding the caption: {e}"))?;
        Ok(Generated {
            caption: clean_caption(&text),
            token_ids,
            prompt_ids,
            image_tokens: n_image,
            resized: patches.resized,
        })
    }

    /// `Lfm2VlCaptioner.caption(image_path, prompt)`.
    pub fn caption(&mut self, image_path: &Path, prompt: Option<&str>) -> anyhow::Result<String> {
        let img = preprocess::load_rgb(image_path)?;
        let prompt = prompt.filter(|p| !p.is_empty()).unwrap_or(DEFAULT_PROMPT);
        Ok(self.generate(&img, prompt, DEFAULT_MAX_NEW_TOKENS)?.caption)
    }
}

/// A float tensor (f32 or f16) as (shape, f32 values).
fn to_f32(v: &DynValue) -> anyhow::Result<(Vec<i64>, Vec<f32>)> {
    let (ty, shape) = dims(v.dtype()).ok_or_else(|| anyhow!("not a tensor"))?;
    let shape = shape.to_vec();
    match ty {
        TensorElementType::Float32 => {
            let (_, data) = v.try_extract_tensor::<f32>()?;
            Ok((shape, data.to_vec()))
        }
        TensorElementType::Float16 => Ok((shape, f16_values(v)?.map(f16_to_f32).collect())),
        other => bail!("expected a float tensor, got {other:?}"),
    }
}

/// The raw fp16 bits of a CPU tensor (`ort` has no f16 type without `half`).
fn f16_values(v: &DynValue) -> anyhow::Result<impl Iterator<Item = u16> + '_> {
    let (_, shape) = dims(v.dtype()).ok_or_else(|| anyhow!("not a tensor"))?;
    let n: usize = shape.iter().map(|d| (*d).max(0) as usize).product();
    if !v.memory_info().is_cpu_accessible() {
        bail!("fp16 tensor is not in CPU memory");
    }
    let ptr = v.data_ptr().cast::<u16>();
    // SAFETY: a CPU tensor of `n` fp16 elements owned by `v` (checked above);
    // the slice lives no longer than the borrow of `v`.
    let data: &[u16] = if n == 0 || ptr.is_null() {
        &[]
    } else {
        unsafe { std::slice::from_raw_parts(ptr, n) }
    };
    Ok(data.iter().copied())
}

/// IEEE 754 binary16 to binary32 (exact).
pub fn f16_to_f32(h: u16) -> f32 {
    let sign = ((h >> 15) as u32) << 31;
    let exp = ((h >> 10) & 0x1f) as u32;
    let frac = (h & 0x3ff) as u32;
    let bits = match (exp, frac) {
        (0, 0) => sign,
        (0, f) => {
            // Subnormal: normalise.
            let mut e: i32 = 127 - 15 + 1;
            let mut f = f;
            while f & 0x400 == 0 {
                f <<= 1;
                e -= 1;
            }
            sign | ((e as u32) << 23) | ((f & 0x3ff) << 13)
        }
        (0x1f, 0) => sign | 0x7f80_0000,
        (0x1f, f) => sign | 0x7f80_0000 | (f << 13),
        (e, f) => sign | ((e + 127 - 15) << 23) | (f << 13),
    };
    f32::from_bits(bits)
}

/// `int(np.asarray(logits[0, -1], dtype=np.float32).argmax())`: the first
/// index of the maximum of the last row.
fn last_row_argmax(logits: &DynValue) -> anyhow::Result<i64> {
    let (ty, shape) = dims(logits.dtype()).ok_or_else(|| anyhow!("logits: not a tensor"))?;
    let vocab = *shape.last().ok_or_else(|| anyhow!("logits: scalar"))? as usize;
    if vocab == 0 {
        bail!("logits: empty vocabulary");
    }
    let row: Vec<f32> = match ty {
        TensorElementType::Float32 => {
            let (_, data) = logits.try_extract_tensor::<f32>()?;
            data[data.len() - vocab..].to_vec()
        }
        TensorElementType::Float16 => {
            let all: Vec<u16> = f16_values(logits)?.collect();
            all[all.len() - vocab..]
                .iter()
                .map(|&h| f16_to_f32(h))
                .collect()
        }
        other => bail!("logits: unexpected dtype {other:?}"),
    };
    Ok(argmax(&row) as i64)
}

/// numpy's `argmax`: the first maximum; NaN wins like in numpy.
pub fn argmax(v: &[f32]) -> usize {
    let mut best = 0;
    for (i, &x) in v.iter().enumerate() {
        if x.is_nan() {
            return i;
        }
        if x > v[best] {
            best = i;
        }
    }
    best
}
