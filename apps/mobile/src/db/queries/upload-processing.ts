/**
 * "Uploaded, but the server is still processing it" (#2740).
 *
 * `/api/upload/complete/` answers as soon as the bytes are in and the photo row
 * exists; thumbnails, the date and the rest are made afterwards by the server's
 * import job. Until a delta sync brings that photo into the mirror *with a
 * thumbnail* (`aspect_ratio` is set exactly when the server has one), the asset
 * is neither "only on this phone" nor in the timeline. The Backup screen counts
 * these, its queue rows and the grid tiles name the state, and all three read
 * the one predicate below so they cannot disagree.
 *
 * An upload is matched to its mirror row by the photo id the completion
 * answered with, or by the asset's hash (a duplicate the server already had
 * answers with no new photo). Once matched with a thumbnail the queue row is
 * *settled* (`server_ready_at`), which keeps it settled when the photo is later
 * deleted on the server or the mirror is wiped for a re-seed.
 */
import { sql } from "drizzle-orm";
import type { AppDatabase } from "../types";

/** Queue states whose bytes the server has (uploaded, or already there). */
const UPLOADED_STATES = `('done', 'skipped_exists')`;

/**
 * True for an `upload_queue uq` row (with its `local_asset la`) whose photo the
 * server is still processing. Needs both aliases in scope.
 */
export const PROCESSING_ON_SERVER = `
  uq.state IN ${UPLOADED_STATES} AND uq.server_ready_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM remote_photo rp
                  WHERE rp.id = uq.server_photo_id AND rp.aspect_ratio IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM remote_photo rp
                  WHERE rp.image_hash = la.hash AND rp.aspect_ratio IS NOT NULL)`;

/**
 * Settle every uploaded row whose photo is now in the mirror with a thumbnail.
 * Runs in the delta applier's transaction, after the page's upserts.
 */
export function settleUploads(db: AppDatabase, now: number): void {
  db.run(
    sql`UPDATE upload_queue SET server_ready_at = ${now}
        WHERE state IN ${sql.raw(UPLOADED_STATES)} AND server_ready_at IS NULL
          AND (EXISTS (SELECT 1 FROM remote_photo rp
                       WHERE rp.id = upload_queue.server_photo_id AND rp.aspect_ratio IS NOT NULL)
               OR EXISTS (SELECT 1 FROM local_asset la JOIN remote_photo rp ON rp.image_hash = la.hash
                          WHERE la.id = upload_queue.asset_id AND rp.aspect_ratio IS NOT NULL))`
  );
}
