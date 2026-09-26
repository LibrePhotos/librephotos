/**
 * app_meta key/value accessors — app-level sync metadata that isn't per-entity
 * (last-seen favorite_min_rating, last integrity snapshot). See schema.ts.
 */
import { sql } from "drizzle-orm";
import type { AppDatabase } from "../types";

export function getMeta(db: AppDatabase, key: string): string | null {
  const row = db.get(sql`SELECT value FROM app_meta WHERE key = ${key}`) as
    | { value: string | null }
    | undefined;
  return row?.value ?? null;
}

export function setMeta(db: AppDatabase, key: string, value: string, now = Date.now()): void {
  db.run(
    sql`INSERT INTO app_meta (key, value, updated_at) VALUES (${key}, ${value}, ${now})
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  );
}

export function getMetaNumber(db: AppDatabase, key: string): number | null {
  const raw = getMeta(db, key);
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function setMetaNumber(db: AppDatabase, key: string, value: number, now = Date.now()): void {
  setMeta(db, key, String(value), now);
}

/** Known app_meta keys (avoids magic strings across the sync engine). */
export const META_FAVORITE_MIN_RATING = "favorite_min_rating";
export const META_LAST_INTEGRITY = "last_integrity";
