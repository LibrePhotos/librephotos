// GET /api/photos/shared/tome/ and /api/photos/shared/fromme/ (api/views/sharing.py,
// HugeResultsSetPagination: 2500 per page, page_size <= 5000). Both walk
// api_photo_shared_to with a JOIN like Django: the through table has no
// unique pair, so a duplicated share is listed twice there too. Port of
// lp_api::search_sharing_public::sharing + lp_db::search_sharing_public::sharing.
import { sql } from "drizzle-orm";
import { row, rows } from "~/lib/db";
import { drfPage, offset, pageRequest, validFor } from "~/lib/pagination";
import { pigByIds, pigFetch } from "~/lib/pig";
import type { QueryMap } from "~/lib/query";
import { ownedBy, visibleManager } from "~/lib/scope";
import type { User } from "~/lib/users";

const PAGE_SIZE = 2500;
const MAX_PAGE_SIZE = 5000;

/** Visible photos shared directly to the caller, oldest first (exif_timestamp, NULLs last). */
export async function sharedToMe(user: User, q: QueryMap, request: Request) {
  const req0 = pageRequest(q, "page_size", PAGE_SIZE, MAX_PAGE_SIZE);
  const c = await row<{ n: number }>(sql`SELECT count(*)::int AS n FROM api_photo p
    JOIN api_photo_shared_to st ON st.photo_id = p.id WHERE st.user_id = ${user.id} AND ${visibleManager("p")}`);
  const count = c?.n ?? 0;
  const req = validFor(req0, count);
  const photos = count
    ? await pigFetch(sql`JOIN api_photo_shared_to st ON st.photo_id = p.id WHERE st.user_id = ${user.id} AND ${visibleManager("p")}
        ORDER BY p.exif_timestamp ASC, p.id, st.id LIMIT ${req.pageSize} OFFSET ${offset(req)}`)
    : [];
  return drfPage(request, req, count, photos);
}

/** SharedFromMePhotoThroughSerializer rows (user_id, user, photo) of the caller's visible photos. */
export async function sharedFromMe(user: User, q: QueryMap, request: Request) {
  const req0 = pageRequest(q, "page_size", PAGE_SIZE, MAX_PAGE_SIZE);
  const scope = sql`${ownedBy("p", user.id)} AND ${visibleManager("p")}`;
  const c = await row<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM api_photo_shared_to st JOIN api_photo p ON p.id = st.photo_id WHERE ${scope}`,
  );
  const count = c?.n ?? 0;
  const req = validFor(req0, count);
  if (!count) return drfPage(request, req, count, []);
  const rs = await rows<{ user_id: number; username: string; first_name: string; last_name: string; photo_id: string }>(
    sql`SELECT st.user_id, u.username, u.first_name, u.last_name, st.photo_id
      FROM api_photo_shared_to st JOIN api_photo p ON p.id = st.photo_id
      JOIN api_user u ON u.id = st.user_id WHERE ${scope}
      ORDER BY p.exif_timestamp ASC, p.id, st.id LIMIT ${req.pageSize} OFFSET ${offset(req)}`,
  );
  const ids = [...new Set(rs.map((r) => r.photo_id))].sort();
  const byId = new Map((await pigByIds(ids)).map((p) => [p.id, p]));
  const items = rs.flatMap((r) => {
    const photo = byId.get(r.photo_id);
    return photo
      ? [{ user_id: r.user_id, user: { id: r.user_id, username: r.username, first_name: r.first_name, last_name: r.last_name }, photo }]
      : [];
  });
  return drfPage(request, req, count, items);
}
