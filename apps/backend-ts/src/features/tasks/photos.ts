// The photo columns the tasks need, loaded in batches (port of lp_tasks::photos),
// and per-photo fan-out with a shared job counter (lp_tasks::fanout).
import path from "node:path";
import { config } from "../../lib/config";
import { arrayLiteral, client } from "../../lib/db";
import { CANCEL_CHECK_EVERY, ItemCounter, isCancelled } from "./run";

export interface TaskPhoto {
  id: string;
  image_hash: string;
  owner_id: number;
  video: boolean;
  main_path: string | null;
  /** Thumbnail.thumbnail_big (relative to MEDIA_ROOT); null without a row, maybe "". */
  thumbnail_big: string | null;
}

/** A Django FileField name (`thumbnails_big/x.webp`) as a path under MEDIA_ROOT (FieldFile.path). */
export function mediaPath(name: string): string {
  return path.join(config.mediaRoot, ...name.split(/[\\/]/).filter(Boolean));
}

/** `photo.thumbnail.thumbnail_big.path` when the photo has one. */
export const thumbnailPath = (p: Pick<TaskPhoto, "thumbnail_big">): string | null =>
  p.thumbnail_big ? mediaPath(p.thumbnail_big) : null;

export async function loadPhotos(ids: string[]): Promise<Map<string, TaskPhoto>> {
  if (!ids.length) return new Map();
  const rs: TaskPhoto[] = await client`SELECT p.id::text AS id, p.image_hash, p.owner_id, p.video, f.path AS main_path, t.thumbnail_big
    FROM api_photo p LEFT JOIN api_file f ON f.hash = p.main_file_id LEFT JOIN api_thumbnail t ON t.photo_id = p.id
    WHERE p.id = ANY(${arrayLiteral(ids)}::uuid[])`;
  return new Map(rs.map((r) => [r.id, r]));
}

export async function loadPhoto(id: string): Promise<TaskPhoto | undefined> {
  return (await loadPhotos([id])).get(id);
}

/**
 * Photos in flight per job. The sidecars serve one inference at a time, so
 * more only queues requests on their side.
 */
export const PHOTO_CONCURRENCY = 4;

/**
 * Run `work` for every id (a thrown error or returned message records a
 * per-item error), polling for cancellation every 100 items, then finish
 * the job once its counter reached the target. False when cancelled.
 */
export async function forEachPhoto(
  jobId: string,
  ids: string[],
  concurrency: number,
  work: (id: string) => Promise<void>,
): Promise<boolean> {
  if (await isCancelled(jobId)) return false;
  const counter = new ItemCounter(jobId, ids.length);
  const limit = Math.max(1, Math.min(concurrency, Math.max(1, config.workerConcurrency)));
  let next = 0;
  let seen = 0;
  let cancelled = false;
  const worker = async () => {
    while (!cancelled && next < ids.length) {
      const id = ids[next++];
      let error: string | null = null;
      try {
        await work(id);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      await counter.done(error);
      seen++;
      if (seen % CANCEL_CHECK_EVERY === 0 && (await isCancelled(jobId))) cancelled = true;
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, ids.length) }, worker));
  if (cancelled) {
    await counter.flush();
    return false;
  }
  await counter.finish();
  return true;
}
