import { sql, type SQL } from "drizzle-orm";
import { runBatch } from "../batch";
import type { AppDatabase } from "../types";
import { META_FAVORITE_MIN_RATING } from "./app-meta";

export const EDIT_FIELDS = ["rating", "caption", "keywords", "takenAt"] as const;
export type EditField = (typeof EDIT_FIELDS)[number];

export const DEFAULT_FAVORITE_MIN_RATING = 4;
export const MAX_RATING = 5;

export type LocalEdits = {
  rating?: number;
  caption?: string | null;
  keywords?: readonly string[];
  takenAt?: string;
};

export type LocalAssetEdits = {
  id: string;
  rating: number | null;
  isFavorite: boolean;
  caption: string | null;
  keywords: string[];
  takenAt: string | null;
  editedAt: number | null;
  appOnly: EditField[];
};

const FAVORITE_MIN = sql`COALESCE((SELECT CAST(value AS INTEGER) FROM app_meta WHERE key = ${META_FAVORITE_MIN_RATING}), ${DEFAULT_FAVORITE_MIN_RATING})`;

export function isFavoriteSql(rating: SQL): SQL {
  return sql`CASE WHEN ${rating} IS NULL THEN NULL WHEN ${rating} >= ${FAVORITE_MIN} THEN 1 ELSE 0 END`;
}

export function appOnlyHas(field: EditField, column: SQL = sql`app_only_fields`): SQL {
  return sql`(instr(COALESCE(${column}, ''), ${`,${field},`}) > 0)`;
}

export function clampRating(rating: number): number {
  return Number.isFinite(rating) ? Math.max(0, Math.min(MAX_RATING, Math.round(rating))) : 0;
}

export function normalizeKeywords(keywords: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of keywords) {
    const word = raw.trim();
    const key = word.toLowerCase();
    if (word.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push(word);
  }
  return out;
}

export function keywordsJson(keywords: readonly string[] | null | undefined): string | null {
  if (keywords == null) return null;
  const list = normalizeKeywords(keywords);
  return list.length > 0 ? JSON.stringify(list) : null;
}

export function parseKeywords(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

const ISO_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/;

export function wallClockMs(iso: string): number | null {
  const m = ISO_LOCAL.exec(iso);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  if (y === undefined || mo === undefined || d === undefined || h === undefined || mi === undefined || s === undefined) {
    return null;
  }
  const ms = Date.UTC(y, mo - 1, d, h, mi, s);
  return Number.isFinite(ms) ? ms : null;
}

function nextAppOnly(current: string | null, fields: readonly EditField[], appOnly: boolean): string | null {
  const set = new Set((current ?? "").split(",").filter((f): f is EditField => (EDIT_FIELDS as readonly string[]).includes(f)));
  for (const f of fields) {
    if (appOnly) set.add(f);
    else set.delete(f);
  }
  return set.size > 0 ? `,${[...set].sort().join(",")},` : null;
}

function editedFields(edits: LocalEdits): EditField[] {
  return EDIT_FIELDS.filter((f) => edits[f] !== undefined);
}

export async function setLocalAssetEdits(
  db: AppDatabase,
  uri: string,
  edits: LocalEdits,
  opts: { appOnly: boolean; now?: number }
): Promise<boolean> {
  const fields = editedFields(edits);
  if (fields.length === 0) return false;
  const row = await db.get<{ app_only_fields: string | null } | undefined>(
    sql`SELECT app_only_fields FROM local_asset WHERE uri = ${uri}`
  );
  if (!row) return false;
  const sets: SQL[] = [];
  if (edits.rating !== undefined) {
    const rating = clampRating(edits.rating);
    sets.push(sql`rating = ${rating}`, sql`is_favorite = ${isFavoriteSql(sql`${rating}`)}`);
  }
  if (edits.caption !== undefined) {
    const caption = edits.caption?.trim() ?? "";
    sets.push(sql`caption = ${caption.length > 0 ? caption : null}`);
  }
  if (edits.keywords !== undefined) sets.push(sql`keywords = ${keywordsJson(edits.keywords)}`);
  if (edits.takenAt !== undefined) {
    const ms = wallClockMs(edits.takenAt);
    if (ms === null) throw new Error(`not a local date and time: ${edits.takenAt}`);
    sets.push(sql`taken_at = ${edits.takenAt}`, sql`created_at = ${ms}`, sql`bucket_day = ${edits.takenAt.slice(0, 10)}`);
  }
  sets.push(sql`edited_at = ${opts.now ?? Date.now()}`);
  sets.push(sql`app_only_fields = ${nextAppOnly(row.app_only_fields, fields, opts.appOnly)}`);
  await db.run(sql`UPDATE local_asset SET ${sql.join(sets, sql`, `)} WHERE uri = ${uri}`);
  return true;
}

export async function clearAppOnlyFields(db: AppDatabase, uri: string, fields: readonly EditField[]): Promise<void> {
  const row = await db.get<{ app_only_fields: string | null } | undefined>(
    sql`SELECT app_only_fields FROM local_asset WHERE uri = ${uri}`
  );
  if (!row) return;
  await db.run(
    sql`UPDATE local_asset SET app_only_fields = ${nextAppOnly(row.app_only_fields, fields, false)} WHERE uri = ${uri}`
  );
}

type EditsRow = {
  id: string;
  rating: number | null;
  is_favorite: number | null;
  caption: string | null;
  keywords: string | null;
  taken_at: string | null;
  edited_at: number | null;
  app_only_fields: string | null;
};

export async function localAssetEdits(db: AppDatabase, uri: string): Promise<LocalAssetEdits | null> {
  const row = await db.get<EditsRow | undefined>(
    sql`SELECT id, rating, is_favorite, caption, keywords, taken_at, edited_at, app_only_fields
        FROM local_asset WHERE uri = ${uri} LIMIT 1`
  );
  if (!row) return null;
  return {
    id: row.id,
    rating: row.rating,
    isFavorite: row.is_favorite === 1,
    caption: row.caption,
    keywords: parseKeywords(row.keywords),
    takenAt: row.taken_at,
    editedAt: row.edited_at,
    appOnly: EDIT_FIELDS.filter((f) => (row.app_only_fields ?? "").includes(`,${f},`)),
  };
}

export async function refreshFavorites(db: AppDatabase): Promise<void> {
  await runBatch(db, [sql`UPDATE local_asset SET is_favorite = ${isFavoriteSql(sql`rating`)} WHERE rating IS NOT NULL`]);
}
