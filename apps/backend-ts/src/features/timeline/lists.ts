// GET /api/photos/recentlyadded/ and /api/photos/notimestamp/
// (RecentlyAddedPhotoListViewSet, NoTimestampPhotoViewSet). Port of
// lp_api::timeline_photos::lists + lp_db::timeline_photos::lists.
import { sql } from "drizzle-orm";
import { row, rows } from "~/lib/db";
import { ApiError } from "~/lib/errors";
import { drfPage, offset, pageRequest, validFor } from "~/lib/pagination";
import { pigColumns, pigFromRow, PIG_JOINS, type PigRow } from "~/lib/pig";
import type { QueryMap } from "~/lib/query";
import { ownedBy, visibleManager } from "~/lib/scope";
import { drfTs } from "~/lib/time";
import type { User } from "~/lib/users";

const visibleOwn = (userId: number) => sql`${ownedBy("p", userId)} AND ${visibleManager("p")}`;

/**
 * The owner's visible photos added on the (UTC) day of the most recent
 * upload, newest first. Django sends `date: null` for an empty library,
 * which the frontend schema rejects, so that is "".
 */
export async function recentlyAdded(user: User) {
  const rs = await rows<PigRow & { latest_at: string }>(sql`WITH latest AS (SELECT max(p.added_on) AS at FROM api_photo p WHERE ${visibleOwn(user.id)})
    SELECT ${drfTs("latest.at")} AS latest_at, ${pigColumns()} FROM api_photo p${PIG_JOINS} CROSS JOIN latest
    WHERE ${visibleOwn(user.id)} AND (p.added_on AT TIME ZONE 'UTC')::date = (latest.at AT TIME ZONE 'UTC')::date
    ORDER BY p.added_on DESC, p.id`);
  return { date: rs[0]?.latest_at ?? "", results: rs.map(pigFromRow) };
}

/** One page (oldest upload first) of the owner's visible photos without a timestamp. */
export async function noTimestamp(user: User, q: QueryMap, request: Request) {
  let req = pageRequest(q, "page_size", 100, 200);
  if (req.page === Infinity) {
    const c = await row<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM api_photo p WHERE ${visibleOwn(user.id)} AND p.exif_timestamp IS NULL`,
    );
    req = validFor(req, c?.n ?? 0);
  }
  const rs = await rows<PigRow & { total: number }>(sql`WITH sel AS (SELECT p.id, p.added_on, count(*) OVER () AS total FROM api_photo p
      WHERE ${visibleOwn(user.id)} AND p.exif_timestamp IS NULL ORDER BY p.added_on, p.id LIMIT ${req.pageSize} OFFSET ${offset(req)})
    SELECT sel.total::int AS total, ${pigColumns()} FROM sel JOIN api_photo p ON p.id = sel.id${PIG_JOINS}
    ORDER BY sel.added_on, sel.id`);
  if (!rs.length && req.page > 1) throw ApiError.notFound("Invalid page.");
  return drfPage(request, req, rs[0]?.total ?? 0, rs.map(pigFromRow));
}
