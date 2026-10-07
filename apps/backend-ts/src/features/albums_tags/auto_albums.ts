// Auto (event) albums: list, detail, delete, delete_all and the generation
// jobs (port of lp_api::albums_tags::auto_albums, lp_db::albums_tags::auto_albums
// and lp_db::write::albums_tags::auto_albums, i.e. api/autoalbum.py
// generate_event_albums / regenerate_event_titles / AlbumAuto._generate_title).
// Timestamps travel as epoch microseconds: a JS Date would drop Django's
// microseconds from the album anchors.
import { sql, type SQL } from "drizzle-orm";
import { db, pgArray, row, rows } from "~/lib/db";
import { ApiError } from "~/lib/errors";
import { json } from "~/lib/http";
import { enqueue, JobType } from "~/lib/jobs";
import { drfPage } from "~/lib/pagination";
import type { QueryMap } from "~/lib/query";
import { visibleManager } from "~/lib/scope";
import { drfTs } from "~/lib/time";
import type { User } from "~/lib/users";
import { fetchPage, pageReq, parsePk, searchTerms, type Exec } from "./common";
import { albumsDeleted, clearTombstones, ENTITY } from "./deletion_log";
import { likeEscape } from "~/lib/scope";

export const GENERATE = "albums.auto_generate";
export const TITLES = "albums.auto_titles";

// ------------------------------------------------------------------ reads

/** GET /api/albums/auto/list/ (AlbumAutoListSerializer). */
export async function list(user: User, req: Request, q: QueryMap) {
  const search = searchTerms(q.get("search"));
  // photos__search_instance__search_captions/location, photos__faces__person__name
  const terms = search.map((t) => {
    const pat = `%${likeEscape(t)}%`;
    return sql` AND EXISTS (SELECT 1 FROM api_albumauto_photos sl LEFT JOIN api_photo_search ss ON ss.photo_id = sl.photo_id
      WHERE sl.albumauto_id = a.id AND (ss.search_captions ILIKE ${pat} OR ss.search_location ILIKE ${pat}
        OR EXISTS (SELECT 1 FROM api_face sf JOIN api_person sp ON sp.id = sf.person_id WHERE sf.photo_id = sl.photo_id AND sp.name ILIKE ${pat})))`;
  });
  // The cover is the first row Django's sliced, unordered prefetch yields: link order.
  const { req: pr, paged } = await fetchPage<{
    id: number;
    title: string;
    timestamp: string;
    favorited: boolean;
    photo_count: number;
    cover: unknown;
    total_count: number;
  }>(
    pageReq(q),
    (l, o) => sql`SELECT *, count(*) OVER ()::int AS total_count FROM (
        SELECT a.id, a.title, ${drfTs("a.timestamp")} AS timestamp, a.favorited,
          (SELECT count(DISTINCT p.id)::int FROM api_albumauto_photos l JOIN api_photo p ON p.id = l.photo_id
            WHERE l.albumauto_id = a.id AND NOT p.hidden) AS photo_count,
          (SELECT json_build_object('image_hash', cp.image_hash, 'video', cp.video) FROM api_albumauto_photos l
            JOIN api_photo cp ON cp.id = l.photo_id WHERE l.albumauto_id = a.id AND NOT cp.hidden ORDER BY l.id LIMIT 1) AS cover,
          a.timestamp AS ts_order
        FROM api_albumauto a WHERE a.owner_id = ${user.id}${sql.join(terms, sql``)}) x
      WHERE x.photo_count > 0 ORDER BY x.ts_order DESC, x.id LIMIT ${l} OFFSET ${o}`,
  );
  return drfPage(
    req,
    pr,
    paged.total,
    paged.rows.map((r) => ({
      id: r.id,
      title: r.title,
      timestamp: r.timestamp,
      // Django answers "" when the cover prefetch came back empty.
      photos: r.cover ?? "",
      photo_count: r.photo_count,
      favorited: r.favorited,
    })),
  );
}

const notFoundAuto = () => ApiError.notFound("No AlbumAuto matches the given query.");

/** The owner's auto album if it holds any photo (the viewset's queryset). */
const ownedWithPhotos = (id: number, ownerId: number) =>
  row<{ id: number; title: string; favorited: boolean; timestamp: string; created_on: string; gps_lat: number | null; gps_lon: number | null }>(
    sql`SELECT a.id, a.title, a.favorited, ${drfTs("a.timestamp")} AS timestamp, ${drfTs("a.created_on")} AS created_on, a.gps_lat, a.gps_lon
        FROM api_albumauto a WHERE a.id = ${id} AND a.owner_id = ${ownerId}
          AND EXISTS (SELECT 1 FROM api_albumauto_photos l JOIN api_photo p ON p.id = l.photo_id WHERE l.albumauto_id = a.id)`,
  );

/** FileSystemStorage.url(name) under MEDIA_URL = "/media/". */
const mediaUrl = (name: string) => "/media/" + name.replaceAll("\\", "/").replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");

interface PersonRow {
  id: number;
  name: string;
  face_count: number;
  cover_face_image: string | null;
  cover_photo_hash: string | null;
  cover_photo_video: boolean | null;
  first_face_image: string | null;
  first_face_photo_hash: string | null;
  first_face_photo_video: boolean | null;
  has_cover_face: boolean;
  has_cover_photo: boolean;
}

/** PersonSerializer read fields. */
function personOut(r: PersonRow) {
  const faceUrl = r.has_cover_face ? `/media/${r.cover_face_image ?? ""}` : r.first_face_image ? `/media/${r.first_face_image}` : "";
  const [photoUrl, video] = r.has_cover_photo
    ? [r.cover_photo_hash ?? "", r.cover_photo_video ?? false]
    : [r.first_face_photo_hash ?? "", r.first_face_photo_video ?? "False"];
  return { name: r.name, face_url: faceUrl, face_count: r.face_count, face_photo_url: photoUrl, video, id: r.id };
}

/** GET /api/albums/auto/{id}/ (AlbumAutoSerializer). */
export async function detail(user: User, rawId: string) {
  const id = parsePk(rawId);
  const album = await ownedWithPhotos(id, user.id);
  if (!album) throw notFoundAuto();
  const [photos, people] = await Promise.all([
    // Visible members oldest first (Django's prefetch order is whatever its join yields).
    rows<{
      id: string;
      square_thumbnail: string | null;
      image_hash: string;
      exif_timestamp: string | null;
      exif_gps_lat: number | null;
      exif_gps_lon: number | null;
      rating: number;
      geolocation_json: unknown;
      public: boolean;
      video: boolean;
    }>(
      sql`SELECT p.id, t.square_thumbnail, p.image_hash, ${drfTs("p.exif_timestamp")} AS exif_timestamp, p.exif_gps_lat,
          p.exif_gps_lon, p.rating, p.geolocation_json, p.public, p.video
        FROM api_albumauto_photos l JOIN api_photo p ON p.id = l.photo_id LEFT JOIN api_thumbnail t ON t.photo_id = p.id
        WHERE l.albumauto_id = ${id} AND ${visibleManager("p")} ORDER BY p.exif_timestamp, p.id`,
    ),
    // People on the visible photos, first appearance first (photos, then their faces, in heap order).
    rows<PersonRow>(
      sql`WITH seen AS (
          SELECT o.person_id, min(o.rn) AS ord FROM (
            SELECT f.person_id, row_number() OVER (ORDER BY p.ctid, f.ctid) AS rn
            FROM api_albumauto_photos l JOIN api_photo p ON p.id = l.photo_id JOIN api_face f ON f.photo_id = p.id
            WHERE l.albumauto_id = ${id} AND ${visibleManager("p")} AND NOT f.deleted AND f.person_id IS NOT NULL) o
          GROUP BY o.person_id)
        SELECT pe.id, pe.name, pe.face_count, cf.image AS cover_face_image, cph.image_hash AS cover_photo_hash,
          cph.video AS cover_photo_video, ff.image AS first_face_image, ffp.image_hash AS first_face_photo_hash,
          ffp.video AS first_face_photo_video, (cf.id IS NOT NULL) AS has_cover_face, (cph.id IS NOT NULL) AS has_cover_photo
        FROM seen JOIN api_person pe ON pe.id = seen.person_id
        LEFT JOIN api_face cf ON cf.id = pe.cover_face_id
        LEFT JOIN api_photo cph ON cph.id = pe.cover_photo_id
        LEFT JOIN api_face ff ON ff.id = (SELECT min(f2.id) FROM api_face f2 WHERE f2.person_id = pe.id)
        LEFT JOIN api_photo ffp ON ffp.id = ff.photo_id
        ORDER BY seen.ord`,
    ),
  ]);
  return {
    id: album.id,
    title: album.title,
    favorited: album.favorited,
    timestamp: album.timestamp,
    created_on: album.created_on,
    gps_lat: album.gps_lat,
    people: people.map(personOut),
    gps_lon: album.gps_lon,
    photos: photos.map((p) => ({
      id: p.id,
      square_thumbnail: p.square_thumbnail ? mediaUrl(p.square_thumbnail) : "",
      image_hash: p.image_hash,
      exif_timestamp: p.exif_timestamp,
      exif_gps_lat: p.exif_gps_lat,
      exif_gps_lon: p.exif_gps_lon,
      rating: p.rating,
      geolocation_json: p.geolocation_json,
      public: p.public,
      video: p.video,
    })),
  };
}

// ----------------------------------------------------------------- writes

/** Django's collector for albums `ids`, tombstones first (recipients still linked). */
async function deleteIds(tx: Exec, ids: number[]) {
  if (!ids.length) return;
  await albumsDeleted(tx, ENTITY.albumAuto, ids);
  const arr = pgArray(ids, "int");
  await rows(sql`DELETE FROM api_albumauto_photos WHERE albumauto_id = ANY(${arr})`, tx);
  await rows(sql`DELETE FROM api_albumauto_shared_to WHERE albumauto_id = ANY(${arr})`, tx);
  await rows(sql`DELETE FROM api_albumauto WHERE id = ANY(${arr})`, tx);
}

/** DELETE /api/albums/auto/{id}/ */
export async function remove(user: User, rawId: string) {
  const id = parsePk(rawId);
  if (!(await ownedWithPhotos(id, user.id))) throw notFoundAuto();
  await db.transaction((tx) => deleteIds(tx, [id]));
  return new Response(null, { status: 204 });
}

/** POST /api/albums/auto/delete_all/ answers the JSON string "success". */
export async function deleteAll(user: User) {
  await db.transaction(async (tx) => {
    const ids = (await rows<{ id: number }>(sql`SELECT id FROM api_albumauto WHERE owner_id = ${user.id}`, tx)).map((r) => r.id);
    await deleteIds(tx, ids);
  });
  return json("success");
}

/** start_job: {status, job_id}, or a 500 {status: false, message}. */
async function start(user: User, kind: string, jobType: JobType, description: string) {
  try {
    const { lrjId } = await enqueue(kind, { user_id: user.id }, { lrj: { jobType, userId: user.id } });
    return { status: true, job_id: lrjId };
  } catch (e) {
    console.error(`Could not start ${description}`, e);
    return json({ status: false, message: `Could not start ${description}.` }, 500);
  }
}

/** POST (and GET) /api/autoalbumgen/ */
export const generate = (user: User) => start(user, GENERATE, JobType.GenerateAutoAlbums, "the auto album generation");
/** POST (and GET) /api/autoalbumtitlegen/ */
export const regenerateTitles = (user: User) =>
  start(user, TITLES, JobType.GenerateAutoAlbumTitles, "the auto album title regeneration");

// -------------------------------------------------------------- generator

/** Postgres timestamptz from epoch microseconds, exactly. */
const usTs = (us: number): SQL => sql`(timestamptz 'epoch' + ${String(us)}::bigint * interval '1 microsecond')`;
const US = (col: string) => sql.raw(`(extract(epoch FROM ${col}) * 1000000)::bigint`);

export interface EventPhoto {
  id: string;
  us: number;
  lat: number | null;
  lon: number | null;
}

const HOUR_US = 3_600_000_000;

/** The owner's timestamped photos in events: runs less than 36 h apart. */
export async function eventGroups(ownerId: number): Promise<EventPhoto[][]> {
  const photos = (
    await rows<{ id: string; us: string; lat: number | null; lon: number | null }>(
      sql`SELECT id, ${US("exif_timestamp")} AS us, exif_gps_lat AS lat, exif_gps_lon AS lon FROM api_photo
          WHERE owner_id = ${ownerId} AND exif_timestamp IS NOT NULL`,
    )
  ).map((p) => ({ ...p, us: Number(p.us) }));
  photos.sort((a, b) => a.us - b.us);
  const groups: EventPhoto[][] = [];
  for (const p of photos) {
    const g = groups[groups.length - 1];
    if (g && p.us - g[g.length - 1].us < 36 * HOUR_US) g.push(p);
    else groups.push([p]);
  }
  return groups;
}

/**
 * One step of generate_event_albums: find or create the group's album
 * (merging duplicates), add the photos, re-anchor, locate and retitle it.
 * Groups of fewer than 2 photos are skipped, as in Django.
 */
export async function applyEventGroup(ownerId: number, group: EventPhoto[]) {
  if (group.length < 2) return;
  await db.transaction((tx) => processGroup(tx, ownerId, group));
}

async function processGroup(tx: Exec, ownerId: number, group: EventPhoto[]) {
  const first = group[0].us;
  const last = group[group.length - 1].us;
  const key = first - 11 * HOUR_US - 59 * 60_000_000;
  const albums = (
    await rows<{ id: number; favorited: boolean; us: string }>(
      sql`SELECT a.id, a.favorited, ${US("a.timestamp")} AS us FROM api_albumauto a WHERE a.owner_id = ${ownerId}
          AND (EXISTS (SELECT 1 FROM api_albumauto_photos l JOIN api_photo p ON p.id = l.photo_id
                 WHERE l.albumauto_id = a.id AND p.exif_timestamp BETWEEN ${usTs(first)} AND ${usTs(last)})
               OR a.timestamp = ${usTs(key)})
          AND NOT EXISTS (SELECT 1 FROM api_albumauto_photos l JOIN api_photo p ON p.id = l.photo_id
                 WHERE l.albumauto_id = a.id AND p.exif_timestamp < ${usTs(first)})
          AND NOT EXISTS (SELECT 1 FROM api_albumauto_photos l JOIN api_photo p ON p.id = l.photo_id
                 WHERE l.albumauto_id = a.id AND p.exif_timestamp > ${usTs(last)})
          ORDER BY a.created_on, a.id`,
      tx,
    )
  ).map((a) => ({ ...a, us: Number(a.us) }));

  let changed = false;
  let albumId: number;
  let favorited: boolean;
  let ts: number;
  if (albums.length) {
    const album = albums[0];
    favorited = album.favorited;
    for (const dup of albums.slice(1)) {
      await rows(
        sql`INSERT INTO api_albumauto_photos (albumauto_id, photo_id) SELECT ${album.id}::int, photo_id FROM api_albumauto_photos
            WHERE albumauto_id = ${dup.id} ON CONFLICT DO NOTHING`,
        tx,
      );
      favorited = favorited || dup.favorited;
      // album.shared_to.add(*dup.shared_to.all()): new recipients lose any stale tombstone.
      const added = await rows<{ user_id: number }>(
        sql`INSERT INTO api_albumauto_shared_to (albumauto_id, user_id) SELECT ${album.id}::int, user_id FROM api_albumauto_shared_to
            WHERE albumauto_id = ${dup.id} ON CONFLICT DO NOTHING RETURNING user_id`,
        tx,
      );
      await clearTombstones(
        tx,
        ENTITY.albumAuto,
        [String(album.id)],
        added.map((a) => a.user_id),
      );
      await rows(sql`UPDATE api_albumauto SET favorited = ${favorited}, last_modified = now() WHERE id = ${album.id}`, tx);
      await deleteIds(tx, [dup.id]);
      changed = true;
    }
    albumId = album.id;
    ts = album.us;
  } else {
    const created = await row<{ id: number }>(
      sql`INSERT INTO api_albumauto (title, timestamp, created_on, gps_lat, gps_lon, favorited, owner_id, last_modified)
          VALUES ('Untitled Album', ${usTs(key)}, now(), NULL, NULL, FALSE, ${ownerId}, now()) RETURNING id`,
      tx,
    );
    albumId = created!.id;
    favorited = false;
    ts = key;
    changed = true;
  }

  const added = await rows(
    sql`INSERT INTO api_albumauto_photos (albumauto_id, photo_id)
        SELECT ${albumId}::int, s.id FROM unnest(${pgArray(
          group.map((p) => p.id),
          "uuid",
        )}) WITH ORDINALITY AS s(id, ord) ORDER BY s.ord ON CONFLICT DO NOTHING RETURNING 1`,
    tx,
  );
  if (added.length) changed = true;
  if (ts !== key) {
    ts = key;
    changed = true;
  }

  let gps: [number, number] | null = null;
  if (changed) {
    const locs = group.filter((p) => p.lat !== null && p.lon !== null && p.lat !== 0 && p.lon !== 0);
    if (locs.length) {
      let sLat = 0;
      let sLon = 0;
      for (const p of locs) {
        sLat += p.lat!;
        sLon += p.lon!;
      }
      gps = [sLat / locs.length, sLon / locs.length];
    }
  }
  const title = await generateTitle(tx, albumId, ts);
  await rows(
    sql`UPDATE api_albumauto SET title = ${title}, timestamp = ${usTs(ts)}, favorited = ${favorited},
        gps_lat = CASE WHEN ${gps !== null} THEN ${gps?.[0] ?? null}::float8 ELSE gps_lat END,
        gps_lon = CASE WHEN ${gps !== null} THEN ${gps?.[1] ?? null}::float8 ELSE gps_lon END,
        last_modified = now() WHERE id = ${albumId}`,
    tx,
  );
}

/** Albums regenerate_event_titles walks: [id, timestamp us]. */
export async function titleTargets(ownerId: number): Promise<[number, number][]> {
  const rs = await rows<{ id: number; us: string }>(
    sql`SELECT id, ${US("timestamp")} AS us FROM api_albumauto WHERE owner_id = ${ownerId} ORDER BY id`,
  );
  return rs.map((r) => [r.id, Number(r.us)]);
}

/** au._generate_title(); au.save() for one album. */
export async function retitle(albumId: number, ts: number) {
  const title = await generateTitle(db, albumId, ts);
  await rows(sql`UPDATE api_albumauto SET title = ${title}, last_modified = now() WHERE id = ${albumId}`);
}

export interface TitleInput {
  us: number | null;
  geolocation: unknown;
  people: string[];
}

/**
 * What _generate_title reads: every member and the names of its non-deleted,
 * labelled faces. Django iterates both unordered and ties in the place/people
 * counts go to the first seen, so rows come in heap (ctid) order.
 */
async function generateTitle(tx: Exec, albumId: number, ts: number): Promise<string> {
  const photos = await rows<{ id: string; us: string | null; geolocation_json: unknown }>(
    sql`SELECT p.id, ${US("p.exif_timestamp")} AS us, p.geolocation_json FROM api_albumauto_photos l
        JOIN api_photo p ON p.id = l.photo_id WHERE l.albumauto_id = ${albumId} ORDER BY p.ctid`,
    tx,
  );
  const faces = photos.length
    ? await rows<{ photo_id: string; name: string }>(
        sql`SELECT f.photo_id, pe.name FROM api_face f JOIN api_person pe ON pe.id = f.person_id
            WHERE f.photo_id = ANY(${pgArray(
              photos.map((p) => p.id),
              "uuid",
            )}) AND NOT f.deleted ORDER BY f.ctid`,
        tx,
      )
    : [];
  const peopleOf = new Map<string, string[]>();
  for (const f of faces) {
    const l = peopleOf.get(f.photo_id);
    if (l) l.push(f.name);
    else peopleOf.set(f.photo_id, [f.name]);
  }
  return eventTitle(
    photos.map((p) => ({ us: p.us === null ? null : Number(p.us), geolocation: p.geolocation_json, people: peopleOf.get(p.id) ?? [] })),
    ts,
  );
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const UNKNOWN_PERSON_NAME = "Unknown - Other";

const utc = (us: number) => new Date(Math.floor(us / 1000));

function timeOfDay(hour: number): string {
  if (hour === 0) return "";
  if (hour < 5) return "Early Morning";
  if (hour < 12) return "Morning";
  if (hour < 18) return "Afternoon";
  return "Evening";
}

/** Counter(values).most_common(2) keys: by count, ties in first-seen order. */
function mostCommonTwo(values: string[]): string[] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k]) => k);
}

const fallbackTitle = (us: number) => `Album from ${utc(us).toISOString().slice(0, 10)}`;

/** AlbumAuto._generate_title (pure part); shapes Django would raise on give the fallback. */
export function eventTitle(photos: TitleInput[], ts: number): string {
  let places: string[] = [];
  const people: string[] = [];
  const stamps: number[] = [];
  for (const photo of photos) {
    const g = photo.geolocation;
    if (g === null || g === undefined) {
      // nothing
    } else if (typeof g === "object" && !Array.isArray(g)) {
      const o = g as Record<string, unknown>;
      if (Object.prototype.hasOwnProperty.call(o, "places")) {
        const arr = o.places;
        if (!Array.isArray(arr)) return fallbackTitle(ts);
        if (arr.length) {
          if (!arr.every((v) => typeof v === "string")) return fallbackTitle(ts);
          places = arr as string[];
        }
      }
    } else if ((Array.isArray(g) && g.length === 0) || g === "") {
      // falsy in Python
    } else return fallbackTitle(ts);
    if (photo.us === null) return fallbackTitle(ts);
    stamps.push(photo.us);
    people.push(...photo.people);
  }
  let firstUs = Infinity;
  let lastUs = -Infinity;
  for (const s of stamps) {
    if (s < firstUs) firstUs = s;
    if (s > lastUs) lastUs = s;
  }
  const anchor = stamps.length ? firstUs : ts;
  const a = utc(anchor);
  let when = `${WEEKDAYS[a.getUTCDay()]} ${timeOfDay(a.getUTCHours())}`;
  const loc = places.length ? `in ${mostCommonTwo(places).join(" and ")}` : "";
  const names = mostCommonTwo(people).filter((k) => {
    const l = k.toLowerCase();
    return l !== "unknown" && l !== UNKNOWN_PERSON_NAME;
  });
  const pep = names.length ? `with ${names.join(" and ")}` : "";
  if (stamps.length) {
    const days = Math.floor(Math.floor((lastUs - firstUs) / 1e6) / 86400);
    if (days >= 3) when = `${days} days`;
    // Monday = 0 like Python's weekday().
    const fw = (utc(firstUs).getUTCDay() + 6) % 7;
    const lw = (utc(lastUs).getUTCDay() + 6) % 7;
    if (lw >= 5 && fw >= 5 && lw !== fw) when = "Weekend";
  }
  const title = [when, pep, loc].join(" ").trim();
  return title || fallbackTitle(ts);
}
