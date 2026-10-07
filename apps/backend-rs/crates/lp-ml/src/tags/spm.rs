//! A pure-Rust SentencePiece encoder for BPE models (SigLIP 2's Gemma
//! `tokenizer.model`), so the tag embeddings can be rebuilt without the
//! `sentencepiece` C++ library. Port of `bpe_model.cc` `Model::Encode` plus
//! the byte fallback of `SentencePieceProcessor::Encode`; the protobuf
//! `ModelProto` is read by hand (only the fields encoding needs).
//! Normalisers other than `identity` (a precompiled charsmap) are refused.

use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap};
use std::path::Path;

use anyhow::{Context, bail};

const NORMAL: u64 = 1;
const UNKNOWN: u64 = 2;
const CONTROL: u64 = 3;
const USER_DEFINED: u64 = 4;
const UNUSED: u64 = 5;
const BYTE: u64 = 6;
const MODEL_BPE: u64 = 2;

pub struct SentencePiece {
    /// NORMAL, USER_DEFINED and UNUSED pieces: (id, score, type).
    pieces: HashMap<String, (u32, f32, u64)>,
    /// CONTROL, UNKNOWN and BYTE pieces.
    reserved: HashMap<String, u32>,
    /// USER_DEFINED pieces, matched greedily (longest first) before merging.
    user_defined: Vec<String>,
    unk_id: u32,
    byte_fallback: bool,
    add_dummy_prefix: bool,
    remove_extra_whitespaces: bool,
    escape_whitespaces: bool,
}

struct Reader<'a> {
    b: &'a [u8],
    at: usize,
}

enum Field<'a> {
    Varint(u64),
    Fixed32(u32),
    Bytes(&'a [u8]),
    Other,
}

impl<'a> Reader<'a> {
    fn new(b: &'a [u8]) -> Self {
        Reader { b, at: 0 }
    }

    fn varint(&mut self) -> anyhow::Result<u64> {
        let mut v = 0u64;
        for shift in (0..64).step_by(7) {
            let byte = *self.b.get(self.at).context("truncated varint")?;
            self.at += 1;
            v |= u64::from(byte & 0x7f) << shift;
            if byte & 0x80 == 0 {
                return Ok(v);
            }
        }
        bail!("varint too long")
    }

    fn take(&mut self, n: usize) -> anyhow::Result<&'a [u8]> {
        let s = self
            .at
            .checked_add(n)
            .and_then(|end| self.b.get(self.at..end))
            .context("truncated protobuf field")?;
        self.at += n;
        Ok(s)
    }

    fn next(&mut self) -> anyhow::Result<Option<(u64, Field<'a>)>> {
        if self.at >= self.b.len() {
            return Ok(None);
        }
        let key = self.varint()?;
        let field = match key & 7 {
            0 => Field::Varint(self.varint()?),
            1 => {
                self.take(8)?;
                Field::Other
            }
            2 => {
                let n = self.varint()? as usize;
                Field::Bytes(self.take(n)?)
            }
            5 => {
                let s = self.take(4)?;
                Field::Fixed32(u32::from_le_bytes([s[0], s[1], s[2], s[3]]))
            }
            t => bail!("unsupported protobuf wire type {t}"),
        };
        Ok(Some((key >> 3, field)))
    }
}

impl SentencePiece {
    pub fn load(path: &Path) -> anyhow::Result<SentencePiece> {
        let bytes = std::fs::read(path).with_context(|| format!("reading {}", path.display()))?;
        Self::parse(&bytes).with_context(|| format!("parsing {}", path.display()))
    }

    pub fn parse(bytes: &[u8]) -> anyhow::Result<SentencePiece> {
        let mut sp = SentencePiece {
            pieces: HashMap::new(),
            reserved: HashMap::new(),
            user_defined: Vec::new(),
            unk_id: 0,
            byte_fallback: false,
            add_dummy_prefix: true,
            remove_extra_whitespaces: true,
            escape_whitespaces: true,
        };
        let mut model_type = 1;
        let mut normalizer = String::from("nmt_nfkc");
        let mut charsmap = false;
        let mut id = 0u32;
        let mut r = Reader::new(bytes);
        while let Some((num, f)) = r.next()? {
            match (num, f) {
                (1, Field::Bytes(piece)) => {
                    let (mut text, mut score, mut ty) = (String::new(), 0f32, NORMAL);
                    let mut p = Reader::new(piece);
                    while let Some((n, f)) = p.next()? {
                        match (n, f) {
                            (1, Field::Bytes(s)) => text = String::from_utf8(s.to_vec())?,
                            (2, Field::Fixed32(v)) => score = f32::from_bits(v),
                            (3, Field::Varint(v)) => ty = v,
                            _ => {}
                        }
                    }
                    match ty {
                        CONTROL | UNKNOWN | BYTE => {
                            sp.reserved.insert(text, id);
                        }
                        _ => {
                            if ty == USER_DEFINED {
                                sp.user_defined.push(text.clone());
                            }
                            sp.pieces.insert(text, (id, score, ty));
                        }
                    }
                    if ty == UNKNOWN {
                        sp.unk_id = id;
                    }
                    id += 1;
                }
                (2, Field::Bytes(trainer)) => {
                    let mut t = Reader::new(trainer);
                    while let Some((n, f)) = t.next()? {
                        match (n, f) {
                            (3, Field::Varint(v)) => model_type = v,
                            (35, Field::Varint(v)) => sp.byte_fallback = v != 0,
                            _ => {}
                        }
                    }
                }
                (3, Field::Bytes(norm)) => {
                    let mut t = Reader::new(norm);
                    while let Some((n, f)) = t.next()? {
                        match (n, f) {
                            (1, Field::Bytes(s)) => normalizer = String::from_utf8(s.to_vec())?,
                            (2, Field::Bytes(s)) => charsmap = !s.is_empty(),
                            (3, Field::Varint(v)) => sp.add_dummy_prefix = v != 0,
                            (4, Field::Varint(v)) => sp.remove_extra_whitespaces = v != 0,
                            (5, Field::Varint(v)) => sp.escape_whitespaces = v != 0,
                            _ => {}
                        }
                    }
                }
                _ => {}
            }
        }
        if model_type != MODEL_BPE {
            bail!("only BPE sentencepiece models are supported (model_type {model_type})");
        }
        if charsmap || normalizer != "identity" {
            bail!("only the identity normaliser is supported (got {normalizer:?})");
        }
        // Longest first, so the greedy prefix match prefers the longest symbol.
        sp.user_defined.sort_by_key(|s| std::cmp::Reverse(s.len()));
        Ok(sp)
    }

    fn normalize(&self, text: &str) -> String {
        let mut s = if self.remove_extra_whitespaces {
            let mut out = String::with_capacity(text.len());
            for w in text.split(' ').filter(|w| !w.is_empty()) {
                if !out.is_empty() {
                    out.push(' ');
                }
                out.push_str(w);
            }
            out
        } else {
            text.to_string()
        };
        if self.add_dummy_prefix && !s.is_empty() {
            s.insert(0, ' ');
        }
        if self.escape_whitespaces {
            s = s.replace(' ', "\u{2581}");
        }
        s
    }

    fn piece_to_id(&self, piece: &str) -> Option<u32> {
        self.reserved
            .get(piece)
            .copied()
            .or_else(|| self.pieces.get(piece).map(|p| p.0))
    }

    /// `SentencePieceProcessor.Encode(text)`: ids without BOS/EOS.
    pub fn encode(&self, text: &str) -> Vec<u32> {
        let norm = self.normalize(text);
        struct Symbol {
            start: usize,
            len: usize,
            prev: isize,
            next: isize,
            freeze: bool,
        }
        let mut symbols: Vec<Symbol> = Vec::new();
        let mut at = 0;
        while at < norm.len() {
            let rest = &norm[at..];
            let (len, freeze) = match self
                .user_defined
                .iter()
                .find(|u| rest.starts_with(u.as_str()))
            {
                Some(u) => (u.len(), true),
                None => (rest.chars().next().map_or(1, char::len_utf8), false),
            };
            let i = symbols.len() as isize;
            symbols.push(Symbol {
                start: at,
                len,
                prev: i - 1,
                next: if at + len < norm.len() { i + 1 } else { -1 },
                freeze,
            });
            at += len;
        }

        #[derive(PartialEq)]
        struct Pair {
            score: f32,
            left: usize,
            right: usize,
            size: usize,
        }
        impl Eq for Pair {}
        impl Ord for Pair {
            // bpe_model.cc: the highest score first, then the leftmost.
            fn cmp(&self, o: &Self) -> Ordering {
                self.score
                    .total_cmp(&o.score)
                    .then_with(|| o.left.cmp(&self.left))
            }
        }
        impl PartialOrd for Pair {
            fn partial_cmp(&self, o: &Self) -> Option<Ordering> {
                Some(self.cmp(o))
            }
        }

        let mut agenda = BinaryHeap::new();
        // merged piece -> (left, right) text, for resegmenting UNUSED pieces.
        let mut rev_merge: HashMap<String, (String, String)> = HashMap::new();
        let maybe_add = |symbols: &Vec<Symbol>,
                         agenda: &mut BinaryHeap<Pair>,
                         rev_merge: &mut HashMap<String, (String, String)>,
                         left: isize,
                         right: isize| {
            if left < 0 || right < 0 {
                return;
            }
            let (l, r) = (&symbols[left as usize], &symbols[right as usize]);
            if l.freeze || r.freeze {
                return;
            }
            let piece = &norm[l.start..l.start + l.len + r.len];
            let Some(&(_, score, ty)) = self.pieces.get(piece) else {
                return;
            };
            agenda.push(Pair {
                score,
                left: left as usize,
                right: right as usize,
                size: piece.len(),
            });
            if ty == UNUSED {
                rev_merge.insert(
                    piece.to_string(),
                    (
                        norm[l.start..l.start + l.len].to_string(),
                        norm[r.start..r.start + r.len].to_string(),
                    ),
                );
            }
        };
        for i in 1..symbols.len() {
            maybe_add(
                &symbols,
                &mut agenda,
                &mut rev_merge,
                i as isize - 1,
                i as isize,
            );
        }
        while let Some(top) = agenda.pop() {
            let (l, r) = (&symbols[top.left], &symbols[top.right]);
            if l.len == 0 || r.len == 0 || l.len + r.len != top.size {
                continue;
            }
            let next = r.next;
            symbols[top.left].len += symbols[top.right].len;
            symbols[top.left].next = next;
            if next >= 0 {
                symbols[next as usize].prev = top.left as isize;
            }
            symbols[top.right].len = 0;
            let prev = symbols[top.left].prev;
            maybe_add(
                &symbols,
                &mut agenda,
                &mut rev_merge,
                prev,
                top.left as isize,
            );
            maybe_add(
                &symbols,
                &mut agenda,
                &mut rev_merge,
                top.left as isize,
                next,
            );
        }

        let mut ids = Vec::new();
        let mut i: isize = if symbols.is_empty() { -1 } else { 0 };
        while i >= 0 {
            let s = &symbols[i as usize];
            self.resegment(&norm[s.start..s.start + s.len], &rev_merge, &mut ids);
            i = s.next;
        }
        ids
    }

    fn resegment(
        &self,
        w: &str,
        rev_merge: &HashMap<String, (String, String)>,
        ids: &mut Vec<u32>,
    ) {
        if let Some(&(_, _, UNUSED)) = self.pieces.get(w)
            && let Some((a, b)) = rev_merge.get(w)
        {
            self.resegment(a, rev_merge, ids);
            self.resegment(b, rev_merge, ids);
            return;
        }
        match self.piece_to_id(w) {
            Some(id) if id != self.unk_id => ids.push(id),
            _ if self.byte_fallback => {
                for b in w.bytes() {
                    ids.push(
                        self.piece_to_id(&format!("<0x{b:02X}>"))
                            .unwrap_or(self.unk_id),
                    );
                }
            }
            _ => ids.push(self.unk_id),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn corrupt_models_are_errors() {
        // Field 1, length-delimited, with a length far past the end.
        let huge = [
            0x0a, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01,
        ];
        assert!(SentencePiece::parse(&huge).is_err());
        assert!(SentencePiece::parse(&[0x0a, 0x05, 0x00]).is_err());
        assert!(SentencePiece::parse(&[0x80]).is_err());
        // Valid protobuf, but no BPE trainer spec.
        assert!(SentencePiece::parse(&[]).is_err());
    }
}
