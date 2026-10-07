// GET /api/photos/searchlist/?search=[&photo|video|is_screenshot|is_document]
// (SearchListViewSet + SemanticSearchFilter: DRF SearchFilter over
// search_captions, search_location, tags__name and exif_timestamp, the OCR
// full-text match and the semantic hits). Port of
// lp_api::search_sharing_public::search + lp_db::search_sharing_public::search.
// One statement (plus two sidecar calls with semantic search on).
import { sql, type SQL } from "drizzle-orm";
import { pgArray } from "~/lib/db";
import { ApiError } from "~/lib/errors";
import { groupByDate, pigFromRow, pigRows } from "~/lib/pig";
import type { QueryMap } from "~/lib/query";
import { likeEscape, ownedBy, visibleManager } from "~/lib/scope";
import type { User } from "~/lib/users";
import { queryEmbedding, SEARCH_THRESHOLD, similarityHashes } from "./sidecar";

/** Python's str.isspace set (Unicode White_Space plus \x1c..\x1f). */
const PY_SPACE_CODES = new Set([0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0x1c, 0x1d, 0x1e, 0x1f, 0x85, 0xa0, 0x1680,
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000]);
const isPySpace = (c: string) => PY_SPACE_CODES.has(c.codePointAt(0)!);
const isPlain = (c: string) => !isPySpace(c) && c !== '"' && c !== "'";

/** Index just past the closing quote of the quoted string at `start` (`.` does not match a newline). */
function quotedEnd(chars: string[], start: number): number | null {
  const quote = chars[start];
  let k = start + 1;
  while (k < chars.length) {
    const c = chars[k];
    if (c === quote) return k + 1;
    if (c === "\\") {
      if (k + 1 < chars.length && chars[k + 1] !== "\n") k += 2;
      else return null;
    } else k += 1;
  }
  return null;
}

/** django.utils.text.smart_split: whitespace-separated tokens, quoted runs kept together (quotes included). */
function djangoSmartSplit(text: string): string[] {
  const chars = [...text];
  const n = chars.length;
  const out: string[] = [];
  let i = 0;
  while (i < n) {
    if (isPySpace(chars[i])) {
      i++;
      continue;
    }
    const start = i;
    let j = i;
    while (j < n && isPlain(chars[j])) j++;
    let end: number | null = null;
    while (j < n && (chars[j] === '"' || chars[j] === "'")) {
      let k = quotedEnd(chars, j);
      if (k === null) break;
      while (k < n && isPlain(chars[k])) k++;
      end = k;
      j = k;
    }
    if (end === null) {
      let k = start;
      while (k < n && !isPySpace(chars[k])) k++;
      end = k;
    }
    out.push(chars.slice(start, end).join(""));
    i = end;
  }
  return out;
}

function unescapeStringLiteral(s: string): string {
  const chars = [...s];
  const quote = chars[0] ?? '"';
  const inner = chars.length >= 2 ? chars.slice(1, -1).join("") : "";
  return inner.replaceAll("\\" + quote, quote).replaceAll("\\\\", "\\");
}

const trimChars = (s: string, pred: (c: string) => boolean) => {
  const chars = [...s];
  let a = 0;
  let b = chars.length;
  while (a < b && pred(chars[a])) a++;
  while (b > a && pred(chars[b - 1])) b--;
  return chars.slice(a, b).join("");
};

/** DRF 3.18 search_smart_split: the search terms of ?search=. */
export function smartSplit(search: string): string[] {
  const terms: string[] = [];
  for (const token of djangoSmartSplit(search)) {
    const term = trimChars(token, (c) => c === ",");
    const chars = [...term];
    const first = chars[0];
    if ((first === '"' || first === "'") && chars[chars.length - 1] === first) {
      terms.push(unescapeStringLiteral(term));
    } else {
      for (const sub of term.split(",")) if (sub) terms.push(trimChars(sub, isPySpace));
    }
  }
  return terms;
}

const pattern = (term: string) => `%${likeEscape(term)}%`;

/** Django icontains on Postgres. */
const icontains = (col: string, term: string) => sql`UPPER(${sql.raw(col)}::text) LIKE UPPER(${pattern(term)}) ESCAPE '\\'`;

/**
 * icontains on the PhotoSearch fields and the timestamp text (Django's
 * exif_timestamp::text on a UTC session), the OCR full-text match (the
 * expression of the GIN index api_photo_ocr_text_fts) and semantic hits.
 */
function termWithoutTags(term: string, semantic: string[] | null, p: string, s: string): SQL {
  const parts: SQL[] = [
    icontains(`${s}.search_captions`, term),
    icontains(`${s}.search_location`, term),
    sql`UPPER((${sql.raw(p)}.exif_timestamp AT TIME ZONE 'UTC')::text || '+00') LIKE UPPER(${pattern(term)})`,
    sql`${sql.raw(p)}.id IN (SELECT so.photo_id FROM api_photo_ocr so WHERE to_tsvector('simple'::regconfig, COALESCE(so.text, ''))
      @@ plainto_tsquery('simple'::regconfig, ${term}))`,
  ];
  if (semantic) parts.push(sql`${sql.raw(p)}.image_hash = ANY(${pgArray(semantic, "text")})`);
  return sql`(${sql.join(parts, sql` OR `)})`;
}

/**
 * Django filters all terms in ONE filter() call, so the tags join is shared:
 * a photo matches when every term matches without tags, or one tag row makes
 * every term match. The tag branch is uncorrelated so Postgres hashes it once.
 */
function termsSql(terms: string[], semantic: string[] | null): SQL {
  const plain = sql.join(
    terms.map((t) => termWithoutTags(t, semantic, "p", "pig_s")),
    sql` AND `,
  );
  const tagged = terms.map((t) => sql` AND (${termWithoutTags(t, semantic, "sp", "sps")} OR ${icontains("stg.name", t)})`);
  return sql` AND ((${plain}) OR p.id IN (SELECT stp.photo_id FROM api_tag_photos stp
      JOIN api_tag stg ON stg.id = stp.tag_id
      JOIN api_photo sp ON sp.id = stp.photo_id
      LEFT JOIN api_photo_search sps ON sps.photo_id = sp.id WHERE TRUE${sql.join(tagged, sql``)}))`;
}

export async function searchList(user: User, q: QueryMap) {
  const raw = q.get("search") ?? "";
  if (raw.includes("\0")) throw ApiError.validation("Null characters are not allowed.");
  const terms = smartSplit(raw);
  let semantic: string[] | null = null;
  if (user.semanticSearchTopk > 0 && terms.length) {
    // A CLIP failure of any kind and an unreachable similarity sidecar are 500s (Django).
    let emb: number[];
    try {
      emb = await queryEmbedding(raw);
      semantic = await similarityHashes(user.id, emb, Math.max(user.semanticSearchTopk, 0), SEARCH_THRESHOLD, true);
    } catch (e) {
      throw ApiError.internal(e);
    }
  }
  const media: SQL[] = [];
  if (q.flag("video")) media.push(sql` AND p.video`);
  else if (q.flag("photo")) media.push(sql` AND NOT p.video`);
  if (q.flag("is_screenshot")) media.push(sql` AND p.is_screenshot`);
  if (q.flag("is_document")) media.push(sql` AND p.is_document`);
  const rs = await pigRows(sql`WHERE ${ownedBy("p", user.id)} AND ${visibleManager("p")}${sql.join(media, sql``)}${
    terms.length ? termsSql(terms, semantic) : sql``
  } ORDER BY p.exif_timestamp DESC, p.id`);
  return { results: user.semanticSearchTopk === 0 ? groupByDate(rs) : rs.map(pigFromRow) };
}
