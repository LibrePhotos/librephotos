// GET /api/searchtermexamples/ (SearchTermExamples + api_util.get_search_term_examples):
// random example searches built from the caller's captioned photos, cached
// per user for two hours. Port of lp_api::search_sharing_public::examples +
// lp_db::search_sharing_public::examples.
import { sql } from "drizzle-orm";
import { config } from "~/lib/config";
import { rows } from "~/lib/db";
import { siteSettings } from "~/lib/settings";
import type { User } from "~/lib/users";

const CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const DEFAULT_TERMS = ["for people", "for places", "for things", "for time", "for file path or file name"];

/** Keyed by database and user, like the Rust cache. */
const cache = new Map<string, { at: number; terms: string[] }>();

interface Sample {
  geolocation_json: unknown;
  year: number | null;
  captions_json: unknown;
  face_names: (string | null)[] | null;
}

/** Up to 100 random photos among (at most) 1000 of the user's with a non-empty captions_json. */
function samples(userId: number) {
  return rows<Sample>(sql`SELECT p.geolocation_json, extract(year FROM p.exif_timestamp AT TIME ZONE 'UTC')::int AS year,
      c.captions_json,
      (SELECT json_agg(pp.name ORDER BY f.id) FROM api_face f LEFT JOIN api_person pp ON pp.id = f.person_id
        WHERE f.photo_id = p.id) AS face_names
    FROM (SELECT p0.id FROM api_photo p0 JOIN api_photo_caption c0 ON c0.photo_id = p0.id
          WHERE p0.owner_id = ${userId} AND c0.captions_json IS NOT NULL AND c0.captions_json <> '{}'::jsonb
          LIMIT 1000) cand
    JOIN api_photo p ON p.id = cand.id JOIN api_photo_caption c ON c.photo_id = p.id
    ORDER BY random() LIMIT 100`);
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** The four term sources of one photo. */
function datum(p: Sample, taggingModel: string) {
  let loc: string[] = [];
  if (isObj(p.geolocation_json) && Array.isArray(p.geolocation_json.features)) {
    const features = p.geolocation_json.features as unknown[];
    loc = features
      .slice(Math.max(0, features.length - 5))
      .map((f) => (isObj(f) ? f.text : undefined))
      .filter((t): t is string => typeof t === "string" && !/^\p{N}+$/u.test(t));
  }
  const time = p.year !== null ? [String(p.year)] : [];
  const people = (p.face_names ?? []).map((n) => (n ?? "").split(" ")[0]);
  let things: string[] = [];
  const tags = isObj(p.captions_json) && isObj(p.captions_json[taggingModel]) ? (p.captions_json[taggingModel] as Record<string, unknown>).tags : undefined;
  if (Array.isArray(tags)) things = tags.filter((t): t is string => typeof t === "string");
  return { loc, time, people, things };
}

function shuffled<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** The random draw of get_search_term_examples over every sample. */
function buildTerms(ss: Sample[], taggingModel: string): string[] {
  const terms: string[] = ss.length ? [] : [...DEFAULT_TERMS];
  const pick = (v: string[]) => {
    if (!v.length) return "";
    const t = v[Math.floor(Math.random() * v.length)];
    terms.push(t);
    return t;
  };
  const joined = (...parts: string[]) => shuffled(parts).join(" ");
  for (const s of ss) {
    const d = datum(s, taggingModel);
    const loc = pick(d.loc);
    const time = pick(d.time);
    const thing = pick(d.things);
    const people = pick(d.people);
    if (Math.random() > 0.3) terms.push(joined(loc, people));
    if (Math.random() > 0.3) terms.push(joined(time, people));
    if (Math.random() > 0.9) terms.push(joined(people, thing));
    if (Math.random() > 0.95) terms.push(joined(loc, people, time, thing));
    if (Math.random() > 0.3) terms.push(joined(loc, time));
    if (Math.random() > 0.9) terms.push(joined(loc, thing));
    if (Math.random() > 0.9) terms.push(joined(time, thing));
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of terms) {
    const x = t.trim();
    if (x && !seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

export async function searchTermExamples(user: User) {
  const key = `${config.dbName}:${user.id}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { results: hit.terms };
  const [ss, settings] = await Promise.all([samples(user.id), siteSettings()]);
  const terms = buildTerms(ss, settings.TAGGING_MODEL);
  cache.set(key, { at: Date.now(), terms });
  return { results: terms };
}
