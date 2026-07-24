/**
 * Shared DB types. The query modules are written against `AppDatabase`, a
 * structural type satisfied by BOTH driver instances:
 *   - drizzle-orm/expo-sqlite   (app runtime, synchronous)
 *   - drizzle-orm/better-sqlite3 (Node tests, synchronous)
 * Both are `BaseSQLiteDatabase<"sync", ...>`, so one signature covers both and
 * the exact same SQL runs under test as in production.
 */
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type { Schema } from "./schema";

// `any` for the run-result type param: expo-sqlite and better-sqlite3 return
// different run-result shapes, and the query layer never reads it.
export type AppDatabase = BaseSQLiteDatabase<"sync", unknown, Schema>;

/** A row of the merged timeline (remote UNION local-only), doc 02 §4. */
export type MergedTimelineRow = {
  remote_id: string | null;
  local_id: string | null;
  timestamp: number | null;
  type: string | null;
  aspect_ratio: number | null;
  is_favorite: number; // 0 | 1
  bucket_day: string;
  image_hash: string | null;
  local_uri: string | null;
  dominant_color: string | null;
};

/** A section header / scrubber bucket, doc 02 §4. */
export type TimelineBucket = {
  bucket_day: string;
  count: number;
};
