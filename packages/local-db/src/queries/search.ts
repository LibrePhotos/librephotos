/**
 * Offline search over the mirror (doc 05 §Search). Semantic/CLIP search is
 * server-side and online-only; when offline (or as an instant local fallback)
 * we run cheap LIKE predicates over already-synced text: photo `search_location`,
 * person names, album titles, and `bucket_day` date terms. Results are clearly
 * labeled "offline results" in the UI. Pure SQL so it is Node-tested.
 */
import { sql } from "drizzle-orm";
import { isArray, parseJson } from "../guards";
import type { AppDatabase } from "../types";
import type { PhotoTileRow } from "./filters";
import { getMeta, setMeta } from "./app-meta";

export type SearchPersonHit = { id: number; name: string | null; cover_photo_hash: string | null };
export type SearchAlbumHit = { id: number; title: string; kind: "user" | "auto" | "thing" | "place" | "tag" };

export type OfflineSearchResult = {
  photos: PhotoTileRow[];
  people: SearchPersonHit[];
  albums: SearchAlbumHit[];
};

const PHOTO_COLS = sql`id, image_hash, timestamp, added_on, type, aspect_ratio, is_favorite, dominant_color, bucket_day`;

/** A date-ish query term ("2024", "2024-06", "2024-06-15") → a bucket_day LIKE prefix. */
export const NO_OFFLINE_RESULTS: OfflineSearchResult = Object.freeze({ photos: [], people: [], albums: [] });

export function datePrefixFor(term: string): string | null {
  const t = term.trim();
  if (/^\d{4}$/.test(t)) return `${t}-%`;
  if (/^\d{4}-\d{1,2}$/.test(t)) {
    const [y = "", m = ""] = t.split("-");
    return `${y}-${m.padStart(2, "0")}-%`;
  }
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(t)) {
    const [y = "", m = "", d = ""] = t.split("-");
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return null;
}

/** Run the offline search. `limit` caps each section. */
export async function offlineSearch(db: AppDatabase, rawQuery: string, opts: { limit?: number } = {}): Promise<OfflineSearchResult> {
  const q = rawQuery.trim();
  if (q.length === 0) return { photos: [], people: [], albums: [] };
  const limit = opts.limit ?? 60;
  const like = `%${q}%`;
  const datePrefix = datePrefixFor(q);

  const photos = await db.all<PhotoTileRow>(
    sql`SELECT ${PHOTO_COLS} FROM remote_photo
        WHERE hidden = 0 AND in_trashcan = 0 AND removed = 0
          AND (
            (search_location IS NOT NULL AND search_location LIKE ${like})
            ${datePrefix ? sql`OR bucket_day LIKE ${datePrefix}` : sql``}
          )
        ORDER BY timestamp DESC, id DESC
        LIMIT ${limit}`
  );

  const people = await db.all<SearchPersonHit>(
    sql`SELECT id, name, cover_photo_hash FROM person
        WHERE name IS NOT NULL AND name LIKE ${like}
        ORDER BY face_count DESC LIMIT ${limit}`
  );

  const albums: SearchAlbumHit[] = [
    ...((await db.all<{ id: number; title: string; }>(sql`SELECT id, title FROM user_album WHERE title LIKE ${like} LIMIT ${limit}`))).map((a) => ({ ...a, kind: "user" as const })),
    ...((await db.all<{ id: number; title: string; }>(sql`SELECT id, title FROM auto_album WHERE title LIKE ${like} LIMIT ${limit}`))).map((a) => ({ ...a, kind: "auto" as const })),
    ...((await db.all<{ id: number; title: string; }>(sql`SELECT id, title FROM thing_album WHERE title LIKE ${like} LIMIT ${limit}`))).map((a) => ({ ...a, kind: "thing" as const })),
    ...((await db.all<{ id: number; title: string; }>(sql`SELECT id, title FROM place_album WHERE title LIKE ${like} LIMIT ${limit}`))).map((a) => ({ ...a, kind: "place" as const })),
    ...((await db.all<{ id: number; title: string; }>(sql`SELECT id, title FROM tag_album WHERE title LIKE ${like} LIMIT ${limit}`))).map((a) => ({ ...a, kind: "tag" as const })),
  ];

  return { photos, people, albums };
}

/* ---- recent searches (app_meta) ---------------------------------------- */

const RECENT_KEY = "recent_searches";
const RECENT_MAX = 8;

export async function getRecentSearches(db: AppDatabase): Promise<string[]> {
  const raw = await getMeta(db, RECENT_KEY);
  if (!raw) return [];
  try {
    const arr = parseJson(raw);
    return isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Push a term to the front of the MRU list (dedup, capped). */
export async function pushRecentSearch(db: AppDatabase, term: string, now = Date.now()): Promise<void> {
  const t = term.trim();
  if (!t) return;
  const current = (await getRecentSearches(db)).filter((x) => x.toLowerCase() !== t.toLowerCase());
  const next = [t, ...current].slice(0, RECENT_MAX);
  await setMeta(db, RECENT_KEY, JSON.stringify(next), now);
}

export async function clearRecentSearches(db: AppDatabase, now = Date.now()): Promise<void> {
  await setMeta(db, RECENT_KEY, JSON.stringify([]), now);
}
