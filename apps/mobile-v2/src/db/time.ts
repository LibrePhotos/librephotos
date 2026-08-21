/**
 * Bucket helpers. `bucket_day`/`bucket_month` are precomputed in JS at row-write
 * time (doc 02 §1) so the timeline GROUP BY is a trivial indexed string compare.
 * Buckets are in the device's LOCAL timezone to match the local-asset arm of the
 * merged view, which uses SQLite `strftime(..., 'localtime')`.
 */

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 'YYYY-MM-DD' in local time from an ms-epoch timestamp. */
export function bucketDayFromMs(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 'YYYY-MM' in local time from an ms-epoch timestamp. */
export function bucketMonthFromMs(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

/**
 * Parse a server ISO/`YYYY-MM-DD HH:MM:SS` timestamp to ms-epoch, or null.
 * LibrePhotos emits `exif_timestamp` as an ISO-ish string; dates without a zone
 * are interpreted by the JS engine (local) which is what we want for buckets.
 */
export function parseServerTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}
