// Thing and place albums: lists and grouped details (port of
// lp_api::albums_tags::things_places and lp_db::albums_tags::things_places).
import { sql } from "drizzle-orm";
import { pgArray, row } from "~/lib/db";
import { drfPage } from "~/lib/pagination";
import type { QueryMap } from "~/lib/query";
import { siteSettings } from "~/lib/settings";
import type { User } from "~/lib/users";
import { albumPhotoRows, fetchPage, grouped, lookupId, mediaFilter, pageReq, searchSql, searchTerms, type AlbumSource } from "./common";

type Cover = { image_hash: string; video: boolean };

interface CoverRow {
  id: number;
  title: string;
  photo_count: number;
  thing_type: string | null;
  geolocation_level: number | null;
  cover_photos: Cover[];
  total_count: number;
}

/** The thing types /albums/thing/* show for the active tagging model. */
const activeThingTypes = async () => [`${(await siteSettings()).TAGGING_MODEL}_tag`, "hashtag_attribute"];

/** GET /api/albums/thing/list/ (AlbumThingListSerializer). */
export async function thingList(user: User, req: Request, q: QueryMap) {
  const types = await activeThingTypes();
  const search = searchTerms(q.get("search"));
  // Covers in the order of Django's unordered prefetch: heap order.
  const { req: pr, paged } = await fetchPage<CoverRow>(
    pageReq(q),
    (l, o) => sql`SELECT t.id, t.title, t.photo_count, t.thing_type,
        (SELECT COALESCE(json_agg(json_build_object('image_hash', cp.image_hash, 'video', cp.video) ORDER BY cp.ctid), '[]'::json)
          FROM api_albumthing_cover_photos cl JOIN api_photo cp ON cp.id = cl.photo_id WHERE cl.albumthing_id = t.id) AS cover_photos,
        count(*) OVER ()::int AS total_count
      FROM api_albumthing t WHERE t.owner_id = ${user.id} AND t.photo_count > 0 AND t.thing_type = ANY(${pgArray(types, "text")})
      ${searchSql(["t.title"], search)} ORDER BY t.title DESC, t.id LIMIT ${l} OFFSET ${o}`,
  );
  return drfPage(
    req,
    pr,
    paged.total,
    paged.rows.map((r) => ({ id: r.id, cover_photos: r.cover_photos, title: r.title, photo_count: r.photo_count, thing_type: r.thing_type })),
  );
}

/** GET /api/albums/place/list/ (AlbumPlaceListSerializer). */
export async function placeList(user: User, req: Request, q: QueryMap) {
  const search = searchTerms(q.get("search"));
  // One pass over the owner's place links: per-album correlated subqueries
  // made the planner hash-join all of api_photo once per album.
  const { req: pr, paged } = await fetchPage<CoverRow>(
    pageReq(q),
    (l, o) => sql`SELECT pl.id, pl.title, a.photo_count, pl.geolocation_level,
        COALESCE(array_to_json(a.covers), '[]'::json) AS cover_photos, count(*) OVER ()::int AS total_count
      FROM api_albumplace pl
      JOIN (SELECT r.albumplace_id, max(r.n)::int AS photo_count, array_agg(r.j ORDER BY r.lid) FILTER (WHERE r.rn <= 4) AS covers
            FROM (SELECT cl.albumplace_id, cl.id AS lid, json_build_object('image_hash', cp.image_hash, 'video', cp.video) AS j,
                    row_number() OVER (PARTITION BY cl.albumplace_id ORDER BY cl.id) AS rn,
                    count(*) OVER (PARTITION BY cl.albumplace_id) AS n
                  FROM api_albumplace_photos cl
                  JOIN api_albumplace p2 ON p2.id = cl.albumplace_id AND p2.owner_id = ${user.id}
                  JOIN api_photo cp ON cp.id = cl.photo_id AND NOT cp.hidden) r
            GROUP BY r.albumplace_id) a ON a.albumplace_id = pl.id
      WHERE pl.owner_id = ${user.id}${searchSql(["pl.title"], search)} ORDER BY pl.title, pl.id LIMIT ${l} OFFSET ${o}`,
  );
  return drfPage(
    req,
    pr,
    paged.total,
    paged.rows.map((r) => ({
      id: r.id,
      geolocation_level: r.geolocation_level,
      cover_photos: r.cover_photos,
      title: r.title,
      photo_count: r.photo_count,
    })),
  );
}

/**
 * {"results": {id: "<id>", title, grouped_photos}}; an album the user may not
 * see serializes as GroupedThingPhotosSerializer(None).data: {"title": ""}.
 */
async function groupedResponse(header: { id: number; title: string } | undefined, src: (id: number) => AlbumSource, q: QueryMap) {
  if (!header) return { results: { title: "" } };
  const photos = await albumPhotoRows(src(header.id), mediaFilter(q));
  return { results: { id: String(header.id), title: header.title, grouped_photos: grouped(photos) } };
}

/** GET /api/albums/thing/{id}/ */
export async function thingDetail(user: User, rawId: string, q: QueryMap) {
  const id = lookupId(rawId);
  const header =
    id === undefined
      ? undefined
      : await row<{ id: number; title: string }>(
          sql`SELECT id, title FROM api_albumthing WHERE id = ${id} AND owner_id = ${user.id} AND photo_count > 0
              AND thing_type = ANY(${pgArray(await activeThingTypes(), "text")})`,
        );
  return groupedResponse(header, (id) => ({ kind: "thing", id }), q);
}

/** GET /api/albums/place/{id}/ */
export async function placeDetail(user: User, rawId: string, q: QueryMap) {
  const id = lookupId(rawId);
  const header =
    id === undefined
      ? undefined
      : await row<{ id: number; title: string }>(
          sql`SELECT pl.id, pl.title FROM api_albumplace pl WHERE pl.id = ${id} AND pl.owner_id = ${user.id}
              AND EXISTS (SELECT 1 FROM api_albumplace_photos l JOIN api_photo p ON p.id = l.photo_id
                WHERE l.albumplace_id = pl.id AND NOT p.hidden)`,
        );
  return groupedResponse(header, (id) => ({ kind: "place", id }), q);
}
