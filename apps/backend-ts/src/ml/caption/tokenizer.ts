// The LFM2 byte-level BPE tokenizer of LFM2.5-VL's `tokenizer.json`, giving
// the ids and text the Hugging Face `tokenizers` library gives (what
// lp_ml::tokenize and the Python sidecar use). Covers what that file uses:
// added tokens (special and not), no normalizer, the GPT-4-style Split
// (Isolated) + ByteLevel (no regex, no prefix space) pre-tokenizers, plain
// BPE (no suffix, no byte fallback), the <|startoftext|> template and the
// ByteLevel decoder. Anything else in a tokenizer.json is refused at load.
import { readFileSync } from "node:fs";

/** Oniguruma's `\s` (what `tokenizers` regexes use; JS's differs on U+0085 / U+FEFF). */
const WS = "\\t\\n\\v\\f\\r \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";

/** The Split pattern LFM2's tokenizer.json carries (Oniguruma syntax). */
const LFM2_SPLIT =
  "(?i:'s|'t|'re|'ve|'m|'ll|'d)|[^\\r\\n\\p{L}\\p{N}]?\\p{L}+|\\p{N}{1,3}| ?[^\\s\\p{L}\\p{N}]+[\\r\\n]*|\\s*[\\r\\n]+|\\s+(?!\\S)|\\s+";

/**
 * {@link LFM2_SPLIT} as a JS regex: `(?i:...)` spelled out (Oniguruma's
 * case folding also lets the long s U+017F match `s`), `\s` / `\S` as
 * Oniguruma's whitespace class.
 */
const SPLIT_RE = new RegExp(
  `'(?:[sS\\u017f]|[tT]|[rR][eE]|[vV][eE]|[mM]|[lL][lL]|[dD])|[^\\r\\n\\p{L}\\p{N}]?\\p{L}+|\\p{N}{1,3}| ?[^${WS}\\p{L}\\p{N}]+[\\r\\n]*|[${WS}]*[\\r\\n]+|[${WS}]+(?![^${WS}])|[${WS}]+`,
  "gu",
);

/** The GPT-2 byte -> printable character table, and its inverse. */
const BYTE_CHARS: string[] = (() => {
  const keep = new Set<number>();
  for (let b = 0x21; b <= 0x7e; b++) keep.add(b);
  for (let b = 0xa1; b <= 0xac; b++) keep.add(b);
  for (let b = 0xae; b <= 0xff; b++) keep.add(b);
  const out: string[] = new Array(256);
  let n = 0;
  for (let b = 0; b < 256; b++) out[b] = String.fromCodePoint(keep.has(b) ? b : 256 + n++);
  return out;
})();
const CHAR_BYTES = new Map<number, number>(BYTE_CHARS.map((c, b) => [c.codePointAt(0)!, b]));

interface Step {
  type: string;
  pattern?: { Regex?: string; String?: string };
  behavior?: string;
  invert?: boolean;
  add_prefix_space?: boolean;
  use_regex?: boolean;
  pretokenizers?: Step[];
  processors?: Step[];
  decoders?: Step[];
  single?: ({ SpecialToken: { id: string } } | { Sequence: { id: string } })[];
  special_tokens?: Record<string, { ids: number[] }>;
}

interface AddedToken {
  id: number;
  content: string;
  normalized: boolean;
  special: boolean;
  lstrip?: boolean;
  rstrip?: boolean;
  single_word?: boolean;
}

interface TokenizerJson {
  added_tokens?: AddedToken[];
  normalizer?: Step | null;
  pre_tokenizer?: Step | null;
  post_processor?: Step | null;
  decoder?: Step | null;
  model: {
    type: string;
    vocab: Record<string, number>;
    merges: (string | [string, string])[];
    end_of_word_suffix?: string | null;
    continuing_subword_prefix?: string | null;
    byte_fallback?: boolean;
    unk_token?: string | null;
  };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A leftmost-longest matcher over literal strings (aho-corasick's MatchKind::LeftmostLongest). */
function literalMatcher(tokens: string[]): RegExp | null {
  if (!tokens.length) return null;
  // At one position the alternation takes the first alternative that matches: longest first.
  const sorted = [...tokens].sort((a, b) => b.length - a.length);
  return new RegExp(sorted.map(escapeRe).join("|"), "gu");
}

export class Lfm2Tokenizer {
  private vocab: Map<string, number>;
  private idToToken: string[] = [];
  private ranks = new Map<string, number>();
  private specialIds = new Set<number>();
  private rawAdded: Map<string, number>;
  private normAdded: Map<string, number>;
  private rawRe: RegExp | null;
  private normRe: RegExp | null;
  /** Ids the template puts in front of a single sequence (`add_special_tokens`). */
  private prefix: number[] = [];
  private cache = new Map<string, number[]>();
  private encoder = new TextEncoder();
  private decoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true });

  constructor(json: TokenizerJson) {
    const m = json.model;
    if (m.type !== "BPE") throw new Error(`unsupported tokenizer model ${m.type}`);
    if (m.continuing_subword_prefix || m.end_of_word_suffix || m.byte_fallback) throw new Error("unsupported BPE options");
    if (json.normalizer) throw new Error(`unsupported normalizer ${json.normalizer.type}`);
    this.vocab = new Map(Object.entries(m.vocab));
    for (const [t, id] of this.vocab) this.idToToken[id] = t;
    m.merges.forEach((mg, i) => {
      const key = typeof mg === "string" ? mg : `${mg[0]} ${mg[1]}`;
      if (!this.ranks.has(key)) this.ranks.set(key, i);
    });
    const added = json.added_tokens ?? [];
    for (const a of added) {
      if (a.lstrip || a.rstrip || a.single_word) throw new Error(`unsupported added token options on ${a.content}`);
      this.idToToken[a.id] = a.content;
      if (a.special) this.specialIds.add(a.id);
    }
    this.rawAdded = new Map(added.filter((a) => !a.normalized).map((a) => [a.content, a.id]));
    this.normAdded = new Map(added.filter((a) => a.normalized).map((a) => [a.content, a.id]));
    this.rawRe = literalMatcher([...this.rawAdded.keys()]);
    this.normRe = literalMatcher([...this.normAdded.keys()]);

    const pre = json.pre_tokenizer;
    const pres = pre?.type === "Sequence" ? (pre.pretokenizers ?? []) : pre ? [pre] : [];
    const [split, bl] = pres;
    const ok =
      pres.length === 2 &&
      split.type === "Split" &&
      split.pattern?.Regex === LFM2_SPLIT &&
      split.behavior === "Isolated" &&
      !split.invert &&
      bl.type === "ByteLevel" &&
      !bl.add_prefix_space &&
      bl.use_regex === false;
    if (!ok) throw new Error(`unsupported pre-tokenizer ${JSON.stringify(pre)}`);

    const post = json.post_processor;
    const posts = post?.type === "Sequence" ? (post.processors ?? []) : post ? [post] : [];
    for (const p of posts) {
      if (p.type === "ByteLevel") continue; // offsets only
      if (p.type !== "TemplateProcessing") throw new Error(`unsupported post-processor ${p.type}`);
      for (const piece of p.single ?? []) {
        if ("SpecialToken" in piece) this.prefix.push(...(p.special_tokens?.[piece.SpecialToken.id]?.ids ?? []));
        else break;
      }
      const last = p.single?.[p.single.length - 1];
      if (!last || !("Sequence" in last)) throw new Error("unsupported template (tokens after the sequence)");
    }
    const dec = json.decoder;
    const decs = dec?.type === "Sequence" ? (dec.decoders ?? []) : dec ? [dec] : [];
    if (decs.length !== 1 || decs[0].type !== "ByteLevel") throw new Error(`unsupported decoder ${JSON.stringify(dec)}`);
  }

  static load(path: string): Lfm2Tokenizer {
    return new Lfm2Tokenizer(JSON.parse(readFileSync(path, "utf8")) as TokenizerJson);
  }

  /** Split `text` on the literals of `re`: ids for the hits, `rest` for the gaps. */
  private static splitAdded(text: string, re: RegExp | null, table: Map<string, number>, out: number[], rest: (s: string) => void) {
    if (!text) return;
    if (!re) return rest(text);
    let from = 0;
    for (const m of text.matchAll(re)) {
      if (m.index > from) rest(text.slice(from, m.index));
      out.push(table.get(m[0])!);
      from = m.index + m[0].length;
    }
    if (from < text.length) rest(text.slice(from));
  }

  private bpe(word: string, out: number[]) {
    const cached = this.cache.get(word);
    if (cached) {
      for (const id of cached) out.push(id);
      return;
    }
    const syms = Array.from(word);
    for (;;) {
      let best = -1;
      let bestRank = Infinity;
      for (let i = 0; i + 1 < syms.length; i++) {
        const r = this.ranks.get(`${syms[i]} ${syms[i + 1]}`);
        if (r !== undefined && r < bestRank) {
          bestRank = r;
          best = i;
        }
      }
      if (best < 0) break;
      syms.splice(best, 2, syms[best] + syms[best + 1]);
    }
    const ids: number[] = [];
    // No unk token: a symbol outside the vocabulary is dropped, as in `tokenizers`.
    for (const s of syms) {
      const id = this.vocab.get(s);
      if (id !== undefined) ids.push(id);
    }
    if (this.cache.size < 50_000) this.cache.set(word, ids);
    for (const id of ids) out.push(id);
  }

  /** Split (Isolated: matches and the gaps between them), ByteLevel, BPE. */
  private encodeText(text: string, out: number[]) {
    let from = 0;
    const piece = (p: string) => {
      let w = "";
      for (const b of this.encoder.encode(p)) w += BYTE_CHARS[b];
      this.bpe(w, out);
    };
    for (const m of text.matchAll(SPLIT_RE)) {
      if (m.index > from) piece(text.slice(from, m.index));
      piece(m[0]);
      from = m.index + m[0].length;
    }
    if (from < text.length) piece(text.slice(from));
  }

  /** `tokenizer.encode(text, add_special_tokens).ids`. */
  encode(text: string, addSpecialTokens = true): number[] {
    const ids: number[] = addSpecialTokens ? [...this.prefix] : [];
    Lfm2Tokenizer.splitAdded(text, this.rawRe, this.rawAdded, ids, (part) =>
      Lfm2Tokenizer.splitAdded(part, this.normRe, this.normAdded, ids, (p) => this.encodeText(p, ids)),
    );
    return ids;
  }

  /** `tokenizer.decode(ids, skip_special_tokens)`: tokens joined, bytes mapped back, UTF-8 lossy. */
  decode(ids: ArrayLike<number>, skipSpecialTokens = true): string {
    const bytes: number[] = [];
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (skipSpecialTokens && this.specialIds.has(id)) continue;
      const tok = this.idToToken[id];
      if (tok === undefined) continue;
      const mapped: number[] = [];
      let all = true;
      for (const ch of tok) {
        const b = CHAR_BYTES.get(ch.codePointAt(0)!);
        if (b === undefined) {
          all = false;
          break;
        }
        mapped.push(b);
      }
      if (all) for (const b of mapped) bytes.push(b);
      else for (const b of this.encoder.encode(tok)) bytes.push(b);
    }
    return this.decoder.decode(new Uint8Array(bytes));
  }
}
