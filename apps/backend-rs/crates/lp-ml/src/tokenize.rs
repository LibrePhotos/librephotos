//! Hugging Face `tokenizer.json` tokenizers (the Python sidecars use the
//! same `tokenizers` library, so ids are identical).

use std::path::Path;

pub use tokenizers::Tokenizer;

pub fn load(path: &Path) -> anyhow::Result<Tokenizer> {
    Tokenizer::from_file(path)
        .map_err(|e| anyhow::anyhow!("loading tokenizer {}: {e}", path.display()))
}

/// `tokenizer.encode(text).ids[:max_len]` (special tokens added, as the
/// Python default), as i64 for ONNX `input_ids`.
pub fn encode_ids(tok: &Tokenizer, text: &str, max_len: Option<usize>) -> anyhow::Result<Vec<i64>> {
    let enc = tok
        .encode(text, true)
        .map_err(|e| anyhow::anyhow!("tokenizing {text:?}: {e}"))?;
    let ids = enc.get_ids();
    let n = max_len.map_or(ids.len(), |m| m.min(ids.len()));
    Ok(ids[..n].iter().map(|&i| i as i64).collect())
}
