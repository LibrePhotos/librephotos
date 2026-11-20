/**
 * Shared row types. Query modules take an {@link AppDatabase} (./database): one
 * async Drizzle database over whatever executor the runtime provides, so the
 * exact same SQL runs in Node tests, on the phone and on the desktop.
 */
export type { AppDatabase } from "./database";
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
  /** 1 for a camera-roll row the server is still processing after upload (#2740). */
  processing: number; // 0 | 1
};

/** A section header / scrubber bucket, doc 02 §4. */
export type TimelineBucket = {
  bucket_day: string;
  count: number;
};
