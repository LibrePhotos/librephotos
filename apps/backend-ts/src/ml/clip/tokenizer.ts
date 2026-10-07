// The CLIP byte-level BPE tokenizer of a Hugging Face `tokenizer.json`
// (CLIP ViT-B/32, MobileCLIP-S2), giving the ids the `tokenizers` library
// gives (lp_ml::tokenize; the Python sidecars use that library). Covers
// what those files use: added tokens, the NFC + whitespace + lowercase
// normalizer, the Split + ByteLevel pre-tokenizers, BPE with an
// end-of-word suffix, and RobertaProcessing's <start>/<end> tokens.
import { readFileSync } from "node:fs";

/** Oniguruma's `\s` (what `tokenizers` regexes use; JS's differs on U+0085 / U+FEFF). */
const WS = "\\t\\n\\v\\f\\r \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
/** The GPT-2 split of the ByteLevel pre-tokenizer (`use_regex: true`). */
const BYTE_LEVEL_RE = new RegExp(`'s|'t|'re|'ve|'m|'ll|'d| ?\\p{L}+| ?\\p{N}+| ?[^${WS}\\p{L}\\p{N}]+|[${WS}]+(?![^${WS}])|[${WS}]+`, "gu");

/** The GPT-2 byte -> printable character table. */
const BYTE_CHARS: string[] = (() => {
  const keep: number[] = [];
  for (let b = 0x21; b <= 0x7e; b++) keep.push(b);
  for (let b = 0xa1; b <= 0xac; b++) keep.push(b);
  for (let b = 0xae; b <= 0xff; b++) keep.push(b);
  const out: string[] = new Array(256);
  let n = 0;
  for (let b = 0; b < 256; b++) out[b] = String.fromCodePoint(keep.includes(b) ? b : 256 + n++);
  return out;
})();

interface Step {
  type: string;
  pattern?: { Regex?: string; String?: string };
  content?: string;
  behavior?: string;
  invert?: boolean;
  normalizers?: Step[];
  pretokenizers?: Step[];
}

interface TokenizerJson {
  added_tokens?: { id: number; content: string; normalized: boolean; special: boolean }[];
  normalizer?: Step | null;
  pre_tokenizer?: Step | null;
  post_processor?: { type: string; cls?: [string, number]; sep?: [string, number] } | null;
  model: {
    type: string;
    vocab: Record<string, number>;
    merges: (string | [string, string])[];
    end_of_word_suffix?: string | null;
    continuing_subword_prefix?: string | null;
    unk_token?: string | null;
  };
}

/** Oniguruma-flavoured pattern text as a JS regex source (only `\s` differs). */
const onig = (p: string) => p.replaceAll("[^\\s", `[^${WS}`).replaceAll("\\s", `[${WS}]`);

export class ClipTokenizer {
  private vocab: Map<string, number>;
  private ranks = new Map<string, number>();
  private suffix: string;
  private unk: number | undefined;
  private cls: number | null = null;
  private sep: number | null = null;
  /** Added tokens matched on the raw text, then on the normalized text. */
  private rawAdded: Map<string, number>;
  private normAdded: Map<string, number>;
  private split: RegExp | null = null;
  private cache = new Map<string, number[]>();

  constructor(json: TokenizerJson) {
    const m = json.model;
    if (m.type !== "BPE") throw new Error(`unsupported tokenizer model ${m.type}`);
    if (m.continuing_subword_prefix) throw new Error("continuing_subword_prefix is not supported");
    this.vocab = new Map(Object.entries(m.vocab));
    m.merges.forEach((mg, i) => this.ranks.set(typeof mg === "string" ? mg : `${mg[0]} ${mg[1]}`, i));
    this.suffix = m.end_of_word_suffix ?? "";
    this.unk = m.unk_token ? this.vocab.get(m.unk_token) : undefined;
    const added = json.added_tokens ?? [];
    this.rawAdded = new Map(added.filter((a) => !a.normalized).map((a) => [a.content, a.id]));
    this.normAdded = new Map(added.filter((a) => a.normalized).map((a) => [a.content, a.id]));
    const norms = json.normalizer?.type === "Sequence" ? (json.normalizer.normalizers ?? []) : json.normalizer ? [json.normalizer] : [];
    for (const n of norms) {
      const ok = n.type === "NFC" || n.type === "Lowercase" || (n.type === "Replace" && n.pattern?.Regex === "\\s+" && n.content === " ");
      if (!ok) throw new Error(`unsupported normalizer ${JSON.stringify(n)}`);
    }
    const pres = json.pre_tokenizer?.type === "Sequence" ? (json.pre_tokenizer.pretokenizers ?? []) : json.pre_tokenizer ? [json.pre_tokenizer] : [];
    for (const p of pres) {
      if (p.type === "Split") {
        if (p.behavior !== "Removed" || !p.invert || !p.pattern?.Regex) throw new Error(`unsupported Split ${JSON.stringify(p)}`);
        this.split = new RegExp(onig(p.pattern.Regex), "gu");
      } else if (p.type !== "ByteLevel") throw new Error(`unsupported pre-tokenizer ${p.type}`);
    }
    const post = json.post_processor;
    if (post?.type === "RobertaProcessing") {
      this.cls = post.cls?.[1] ?? null;
      this.sep = post.sep?.[1] ?? null;
    } else if (post) throw new Error(`unsupported post-processor ${post.type}`);
  }

  static load(path: string): ClipTokenizer {
    return new ClipTokenizer(JSON.parse(readFileSync(path, "utf8")) as TokenizerJson);
  }

  private normalize(s: string): string {
    return s
      .normalize("NFC")
      .replace(new RegExp(`[${WS}]+`, "gu"), " ")
      .toLowerCase();
  }

  /** Split `text` on the added tokens of `table`: strings to encode, numbers are ids. */
  private static splitAdded(text: string, table: Map<string, number>): (string | number)[] {
    if (!table.size || !text) return text ? [text] : [];
    const out: (string | number)[] = [];
    let at = 0;
    let from = 0;
    while (at < text.length) {
      let hit: string | null = null;
      for (const t of table.keys()) if (text.startsWith(t, at) && (!hit || t.length > hit.length)) hit = t;
      if (hit) {
        if (at > from) out.push(text.slice(from, at));
        out.push(table.get(hit)!);
        at += hit.length;
        from = at;
      } else at++;
    }
    if (from < text.length) out.push(text.slice(from));
    return out;
  }

  private bpe(word: string): number[] {
    const cached = this.cache.get(word);
    if (cached) return cached;
    const chars = Array.from(word);
    const syms = chars.map((c, i) => (i === chars.length - 1 ? c + this.suffix : c));
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
    for (const s of syms) {
      const id = this.vocab.get(s);
      if (id !== undefined) ids.push(id);
      else if (this.unk !== undefined) ids.push(this.unk);
    }
    if (this.cache.size < 50_000) this.cache.set(word, ids);
    return ids;
  }

  private encodePiece(text: string, out: number[]) {
    const pieces = this.split ? Array.from(text.matchAll(this.split), (m) => m[0]) : [text];
    for (const p of pieces) {
      for (const m of p.matchAll(BYTE_LEVEL_RE)) {
        const bytes = new TextEncoder().encode(m[0]);
        let w = "";
        for (const b of bytes) w += BYTE_CHARS[b];
        out.push(...this.bpe(w));
      }
    }
  }

  /** `tokenizer.encode(text).ids[:maxLen]` with the special tokens added. */
  encode(text: string, maxLen?: number): number[] {
    const ids: number[] = [];
    if (this.cls !== null) ids.push(this.cls);
    for (const part of ClipTokenizer.splitAdded(text, this.rawAdded)) {
      if (typeof part === "number") {
        ids.push(part);
        continue;
      }
      for (const p of ClipTokenizer.splitAdded(this.normalize(part), this.normAdded)) {
        if (typeof p === "number") ids.push(p);
        else this.encodePiece(p, ids);
      }
    }
    if (this.sep !== null) ids.push(this.sep);
    return maxLen === undefined ? ids : ids.slice(0, maxLen);
  }
}
