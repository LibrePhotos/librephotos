// SQL of the scan pipeline (port of lp-ingest db.rs). Rows stay exactly what
// Django writes: every NOT NULL column supplied, M2M adds skip existing
// links, auto_now columns bumped where Django's save() would bump them.
// Raw Bun SQL (`client`) throughout: this is the hot path of the scan.
import { arrayLiteral, client } from "../../lib/db";
import type { MetadataUpdate, PhotoUpdate } from "./exifmap";
import { fromPgText, toPgDate, toPgTimestamp, type Micros } from "./dates";
import { truthy, valueStr } from "./pyfmt";

/** client, or a transaction handle from client.begin. */
export type Q = typeof client;
export const begin = <T>(fn: (tx: Q) => Promise<T>): Promise<T> => client.begin((tx) => fn(tx as unknown as Q)) as Promise<T>;

export interface FileRow {
  hash: string;
  path: string;
  type: number;
  missing: boolean;
}

export interface PhotoRow {
  id: string;
  image_hash: string;
  owner_id: number;
  main_file_id: string | null;
  video: boolean;
  local_orientation: number;
  exif_timestamp: Micros | null;
  exif_gps_lat: number | null;
  exif_gps_lon: number | null;
  timestamp: Micros | null;
  category_source: string;
  perceptual_hash: string | null;
  removed: boolean;
  is_screenshot: boolean;
  is_document: boolean;
}

const ts = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US')`;
export const PHOTO_COLS = `p.id::text AS id, p.image_hash, p.owner_id, p.main_file_id, p.video, p.local_orientation,
  ${ts("p.exif_timestamp")} AS exif_timestamp, p.exif_gps_lat, p.exif_gps_lon, ${ts("p.timestamp")} AS timestamp,
  p.category_source, p.perceptual_hash, p.removed, p.is_screenshot, p.is_document`;

type RawPhoto = Omit<PhotoRow, "exif_timestamp" | "timestamp"> & { exif_timestamp: string | null; timestamp: string | null };
export const toPhoto = (r: RawPhoto): PhotoRow => ({ ...r, exif_timestamp: fromPgText(r.exif_timestamp), timestamp: fromPgText(r.timestamp) });

export async function photoById(q: Q, id: string): Promise<PhotoRow | null> {
  const r = await q.unsafe(`SELECT ${PHOTO_COLS} FROM api_photo p WHERE p.id = $1`, [id]);
  return r.length ? toPhoto(r[0]) : null;
}

export async function fileByHash(q: Q, hash: string): Promise<FileRow | null> {
  const r = await q`SELECT hash, path, type, missing FROM api_file WHERE hash = ${hash}`;
  return r[0] ?? null;
}

export async function fileByPath(q: Q, path: string): Promise<FileRow | null> {
  const r = await q`SELECT hash, path, type, missing FROM api_file WHERE path = ${path}`;
  return r[0] ?? null;
}

/** Paths among `paths` that some photo holds as a variant (_known_paths). */
export async function knownPaths(paths: string[]): Promise<Set<string>> {
  const r: { path: string }[] = await client`SELECT f.path FROM api_file f JOIN api_photo_files pf ON pf.file_id = f.hash
    JOIN api_photo p ON p.id = pf.photo_id WHERE f.path = ANY(${arrayLiteral(paths)}::text[])`;
  return new Set(r.map((x) => x.path));
}

export async function pathIsKnown(path: string): Promise<boolean> {
  const [r] = await client`SELECT EXISTS (SELECT 1 FROM api_file f JOIN api_photo_files pf ON pf.file_id = f.hash
    JOIN api_photo p ON p.id = pf.photo_id WHERE f.path = ${path}) AS e`;
  return r.e;
}

/** _last_finished_scan(user).finished_at, as epoch ms. */
export async function lastScanFinishedAt(userId: number): Promise<number | null> {
  const r = await client`SELECT (extract(epoch FROM finished_at) * 1000)::float8 AS t FROM api_longrunningjob
    WHERE finished AND job_type = 1 AND started_by_id = ${userId} AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1`;
  return r[0]?.t ?? null;
}

export async function isEmbeddedMedia(q: Q, hash: string): Promise<boolean> {
  const [r] = await q`SELECT EXISTS (SELECT 1 FROM api_file_embedded_media WHERE to_file_id = ${hash}) AS e`;
  return r.e;
}

/** File.create: the row for `path` (un-flagging a reappeared missing file), else a new row. */
export async function fileCreate(q: Q, path: string, hash: string, type: number, existsOnDisk: () => boolean): Promise<FileRow> {
  const existing = await fileByPath(q, path);
  if (existing) {
    if (existing.missing && existsOnDisk()) {
      await q`UPDATE api_file SET missing = FALSE WHERE hash = ${existing.hash}`;
      return { ...existing, missing: false };
    }
    return existing;
  }
  // Django's file.save() on a hash that is already a row is an UPDATE: the
  // row moves to the path seen last, and is no longer missing.
  const moved = await q`UPDATE api_file SET path = ${path}, type = ${type}, missing = FALSE WHERE hash = ${hash}
    AND NOT EXISTS (SELECT 1 FROM api_file WHERE path = ${path}) RETURNING hash, path, type, missing`;
  if (moved.length) return moved[0];
  const inserted = await q`INSERT INTO api_file (hash, path, type, missing) VALUES (${hash}, ${path}, ${type}, FALSE)
    ON CONFLICT DO NOTHING RETURNING hash, path, type, missing`;
  if (inserted.length) return inserted[0];
  const byPath = await fileByPath(q, path);
  if (byPath) return byPath;
  const byHash = await fileByHash(q, hash);
  if (!byHash) throw new Error(`file row ${hash} vanished`);
  return byHash;
}

/** The owner's photo holding any of `hashes` as variant or main file (lowest id). */
export async function findPhotoWithFiles(q: Q, userId: number, hashes: string[]): Promise<PhotoRow | null> {
  const arr = arrayLiteral(hashes);
  const r = await q.unsafe(
    `SELECT ${PHOTO_COLS} FROM api_photo p WHERE p.owner_id = $1 AND (
       EXISTS (SELECT 1 FROM api_photo_files pf WHERE pf.photo_id = p.id AND pf.file_id = ANY($2::text[]))
       OR p.main_file_id = ANY($2::text[])) ORDER BY p.id LIMIT 1`,
    [userId, arr],
  );
  return r.length ? toPhoto(r[0]) : null;
}

/** photo.files.add(file) unless already linked. */
export async function addPhotoFile(q: Q, photo: string, hash: string) {
  await q`INSERT INTO api_photo_files (photo_id, file_id) SELECT ${photo}::uuid, ${hash}
    WHERE NOT EXISTS (SELECT 1 FROM api_photo_files WHERE photo_id = ${photo}::uuid AND file_id = ${hash})`;
}

export async function fileType(q: Q, hash: string): Promise<number | null> {
  const r = await q`SELECT type FROM api_file WHERE hash = ${hash}`;
  return r[0]?.type ?? null;
}

export const setMainFile = (q: Q, photo: string, hash: string) => q`UPDATE api_photo SET main_file_id = ${hash} WHERE id = ${photo}::uuid`;

/** A new Photo() with Django's field defaults. */
export async function insertPhoto(q: Q, owner: number, imageHash: string, mainFile: string | null, video: boolean): Promise<PhotoRow> {
  const id = crypto.randomUUID();
  await q`INSERT INTO api_photo (id, image_hash, added_on, geolocation_json, hidden, public, owner_id, video, rating, in_trashcan,
      size, main_file_id, last_modified, removed, local_orientation, is_screenshot, is_document, category_source)
    VALUES (${id}::uuid, ${imageHash}, now(), '{}', FALSE, FALSE, ${owner}, ${video}, 0, FALSE, 0, ${mainFile}, now(), FALSE,
      1, FALSE, FALSE, 'auto')`;
  return {
    id, image_hash: imageHash, owner_id: owner, main_file_id: mainFile, video, local_orientation: 1, exif_timestamp: null,
    exif_gps_lat: null, exif_gps_lon: null, timestamp: null, category_source: "auto", perceptual_hash: null, removed: false,
    is_screenshot: false, is_document: false,
  };
}

export const touchPhoto = (q: Q, photo: string) => q`UPDATE api_photo SET last_modified = now() WHERE id = ${photo}::uuid`;

export const linkEmbedded = (q: Q, from: string, to: string) =>
  q`INSERT INTO api_file_embedded_media (from_file_id, to_file_id) VALUES (${from}, ${to}) ON CONFLICT DO NOTHING`;

export interface ThumbRow {
  thumbnail_big: string;
  aspect_ratio: number | null;
  dominant_color: string | null;
}

/** Thumbnail.objects.get_or_create(photo=photo). */
export async function ensureThumbnail(q: Q, photo: string): Promise<ThumbRow> {
  const r = await q`WITH ins AS (INSERT INTO api_thumbnail (photo_id, thumbnail_big, square_thumbnail, square_thumbnail_small)
      VALUES (${photo}::uuid, '', '', '') ON CONFLICT DO NOTHING RETURNING thumbnail_big, aspect_ratio, dominant_color)
    SELECT thumbnail_big, aspect_ratio, dominant_color FROM ins
    UNION ALL SELECT thumbnail_big, aspect_ratio, dominant_color FROM api_thumbnail WHERE photo_id = ${photo}::uuid AND NOT EXISTS (SELECT 1 FROM ins)`;
  // A row a concurrent transaction committed after this statement's snapshot.
  return r[0] ?? (await q`SELECT thumbnail_big, aspect_ratio, dominant_color FROM api_thumbnail WHERE photo_id = ${photo}::uuid`)[0];
}

export interface ThumbWrite {
  big: string;
  square: string;
  small: string;
  aspectRatio: number | null;
}

export const writeThumbnail = (q: Q, photo: string, t: ThumbWrite, dominant: string | null = null) =>
  q`UPDATE api_thumbnail SET thumbnail_big = ${t.big}, square_thumbnail = ${t.square}, square_thumbnail_small = ${t.small},
      aspect_ratio = COALESCE(${t.aspectRatio}::float8, aspect_ratio), dominant_color = COALESCE(dominant_color, ${dominant}::text)
    WHERE photo_id = ${photo}::uuid`;

export const setPerceptualHash = (q: Q, photo: string, phash: string) => q`UPDATE api_photo SET perceptual_hash = ${phash} WHERE id = ${photo}::uuid`;

const pgTs = (v: Micros | null) => (v === null ? null : toPgTimestamp(v));

/** The full photo.save() at the end of extract_date_time. */
export const savePhotoScanFields = (q: Q, photo: string, u: PhotoUpdate, isScreenshot: boolean | null, exifTs: Micros | null) =>
  q`UPDATE api_photo SET size = COALESCE(${u.size}::bigint, size), video_length = COALESCE(${u.videoLength}::text, video_length),
      rating = COALESCE(${u.rating}::int, rating), exif_timestamp_subsec = COALESCE(${u.exifTimestampSubsec}::text, exif_timestamp_subsec),
      image_sequence_number = COALESCE(${u.imageSequenceNumber}::int, image_sequence_number),
      is_screenshot = COALESCE(${isScreenshot}::boolean, is_screenshot), exif_timestamp = ${pgTs(exifTs)}::timestamptz,
      last_modified = now()
    WHERE id = ${photo}::uuid`;

export interface MetaRow {
  id: string;
  camera_make: string | null;
  camera_model: string | null;
  lens_make: string | null;
  lens_model: string | null;
  aperture: number | null;
  iso: number | null;
  focal_length: number | null;
  gps_latitude: number | null;
  gps_longitude: number | null;
  keywords: unknown;
  source: string;
}

const META_COLS = "id::text AS id, camera_make, camera_model, lens_make, lens_model, aperture, iso, focal_length, gps_latitude, gps_longitude, keywords, source";

/** PhotoMetadata get_or_create + _apply_to_metadata + save (the caption unless the user edited it). */
export async function upsertMetadata(q: Q, photo: string, m: MetadataUpdate): Promise<MetaRow> {
  const [first] = await q`WITH ins AS (INSERT INTO api_photometadata (id, photo_id, source, version, created_at, updated_at)
      VALUES (${crypto.randomUUID()}::uuid, ${photo}::uuid, 'embedded', 1, now(), now()) ON CONFLICT (photo_id) DO NOTHING RETURNING source)
    SELECT source FROM ins UNION ALL SELECT source FROM api_photometadata WHERE photo_id = ${photo}::uuid AND NOT EXISTS (SELECT 1 FROM ins)`;
  const source: string = (first ?? (await q`SELECT source FROM api_photometadata WHERE photo_id = ${photo}::uuid`)[0]).source;
  let caption: string | null = null;
  if (m.description !== null) {
    let edited = false;
    if (source === "user_edit") {
      const [r] = await q`SELECT EXISTS (SELECT 1 FROM api_metadataedit e WHERE e.photo_id = ${photo}::uuid AND e.field_name = 'caption'
          AND (e.created_at > (SELECT max(r.created_at) FROM api_metadataedit r WHERE r.photo_id = ${photo}::uuid AND r.field_name = '_all')
               OR NOT EXISTS (SELECT 1 FROM api_metadataedit r WHERE r.photo_id = ${photo}::uuid AND r.field_name = '_all'))) AS e`;
      edited = r.e;
    }
    if (!edited) caption = m.description;
  }
  const kw = m.keywords === null ? null : JSON.stringify(m.keywords);
  const r = await q.unsafe(
    `UPDATE api_photometadata SET aperture = COALESCE($2::float8, aperture), focal_length = COALESCE($3::float8, focal_length),
       iso = COALESCE($4::int, iso), width = COALESCE($5::int, width), height = COALESCE($6::int, height),
       focal_length_35mm = COALESCE($7::int, focal_length_35mm), camera_model = COALESCE($8::text, camera_model),
       lens_model = COALESCE($9::text, lens_model), rating = COALESCE($10::int, rating), shutter_speed = COALESCE($11::text, shutter_speed),
       date_taken_subsec = COALESCE($12::text, date_taken_subsec), keywords = COALESCE($13::text::jsonb, keywords),
       caption = COALESCE($14::text, caption), updated_at = now()
     WHERE photo_id = $1::uuid RETURNING ${META_COLS}`,
    [photo, m.aperture, m.focalLength, m.iso, m.width, m.height, m.focalLength35mm, m.cameraModel, m.lensModel, m.rating, m.shutterSpeed, m.dateTakenSubsec, kw, caption],
  );
  return r[0];
}

/** link_tags_from_keywords: get-or-create each tag, link, recount. */
export async function linkTags(q: Q, owner: number, photo: string, keywords: unknown) {
  if (!Array.isArray(keywords)) return;
  const names = [
    ...new Set(
      keywords
        .filter((k): k is string => typeof k === "string")
        .map((k) => [...k.trim()].slice(0, 512).join(""))
        .filter((k) => k !== ""),
    ),
  ].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const name of names) {
    await q`INSERT INTO api_tag (name, owner_id, photo_count, last_modified) VALUES (${name}, ${owner}, 0, now()) ON CONFLICT (name, owner_id) DO NOTHING`;
    const [{ id }] = await q`SELECT id FROM api_tag WHERE name = ${name} AND owner_id = ${owner}`;
    await q`INSERT INTO api_tag_photos (tag_id, photo_id) VALUES (${id}, ${photo}::uuid) ON CONFLICT DO NOTHING`;
    // tag.photos.add(photo): recount, and the mobile-sync bump even when the link existed.
    await q`UPDATE api_tag SET photo_count = (SELECT count(*) FROM api_tag_photos tp JOIN api_photo p ON p.id = tp.photo_id
        WHERE tp.tag_id = ${id} AND NOT p.hidden AND NOT p.in_trashcan AND NOT p.removed), last_modified = now() WHERE id = ${id}`;
  }
}

/** _import_description_to_caption (+ apply_user_caption's hashtag albums). */
export async function importDescription(q: Q, owner: number, photo: string, imageHash: string, description: string) {
  let [row] = await q`WITH ins AS (INSERT INTO api_photo_caption (photo_id, captions_json, created_at, updated_at)
      VALUES (${photo}::uuid, NULL, now(), now()) ON CONFLICT DO NOTHING RETURNING captions_json)
    SELECT captions_json FROM ins UNION ALL SELECT captions_json FROM api_photo_caption WHERE photo_id = ${photo}::uuid AND NOT EXISTS (SELECT 1 FROM ins)`;
  row ??= (await q`SELECT captions_json FROM api_photo_caption WHERE photo_id = ${photo}::uuid`)[0];
  const c = row?.captions_json;
  const captions: Record<string, unknown> = c && typeof c === "object" && !Array.isArray(c) ? { ...c } : {};
  const previously = captions.imported_description;
  if (previously === description) return;
  const current = typeof captions.user_caption === "string" ? captions.user_caption : "";
  captions.imported_description = description;
  const keepCurrent = current.trim() !== "" && current !== (typeof previously === "string" ? previously : undefined);
  if (!keepCurrent) {
    const caption = description.replaceAll("<start>", "").replaceAll("<end>", "").trim();
    captions.user_caption = caption;
    await q`UPDATE api_photo_caption SET captions_json = ${JSON.stringify(captions)}::text::jsonb, updated_at = now() WHERE photo_id = ${photo}::uuid`;
    await syncHashtags(q, owner, photo, imageHash, caption);
  } else {
    await q`UPDATE api_photo_caption SET captions_json = ${JSON.stringify(captions)}::text::jsonb WHERE photo_id = ${photo}::uuid`;
  }
}

/** _sync_hashtag_album_things: a hashtag_attribute AlbumThing per #tag (with the m2m signal's count/cover refresh). */
async function syncHashtags(q: Q, owner: number, photo: string, imageHash: string, caption: string) {
  for (const tag of caption.split(/\s+/).filter((w) => w.startsWith("#") && [...w].length > 1)) {
    await q`INSERT INTO api_albumthing (title, thing_type, favorited, owner_id, photo_count, last_modified)
      VALUES (${tag}, 'hashtag_attribute', FALSE, ${owner}, 0, now()) ON CONFLICT (title, thing_type, owner_id) DO NOTHING`;
    const [{ id }] = await q`SELECT id FROM api_albumthing WHERE title = ${tag} AND thing_type = 'hashtag_attribute' AND owner_id = ${owner}`;
    const [{ e }] = await q`SELECT EXISTS (SELECT 1 FROM api_albumthing_photos tp JOIN api_photo p ON p.id = tp.photo_id
      WHERE tp.albumthing_id = ${id} AND p.image_hash = ${imageHash}) AS e`;
    if (e) continue;
    await q`INSERT INTO api_albumthing_photos (albumthing_id, photo_id) VALUES (${id}, ${photo}::uuid) ON CONFLICT DO NOTHING`;
    await q`UPDATE api_albumthing SET photo_count = (SELECT count(*) FROM api_albumthing_photos tp JOIN api_photo p ON p.id = tp.photo_id
        WHERE tp.albumthing_id = ${id} AND NOT p.hidden), last_modified = now() WHERE id = ${id}`;
    await q`INSERT INTO api_albumthing_cover_photos (albumthing_id, photo_id)
      SELECT ${id}, p.id FROM api_albumthing_photos tp JOIN api_photo p ON p.id = tp.photo_id
      WHERE tp.albumthing_id = ${id} AND NOT p.hidden AND p.id NOT IN
        (SELECT photo_id FROM api_albumthing_cover_photos WHERE albumthing_id = ${id} AND photo_id IS NOT NULL)
      LIMIT (SELECT CASE WHEN k.n < 4 THEN 4 - k.n ELSE 0 END FROM
        (SELECT count(*) AS n FROM api_albumthing_cover_photos WHERE albumthing_id = ${id}) k)`;
  }
}

async function albumDateId(q: Q, owner: number, date: string | null): Promise<number | null> {
  const r = await q`SELECT id FROM api_albumdate WHERE owner_id = ${owner} AND date IS NOT DISTINCT FROM ${date}::date ORDER BY id LIMIT 1`;
  return r[0]?.id ?? null;
}

/** extract_date_time's album move: out of the old day album, into the one of the (new) date. */
export async function moveToAlbumDate(q: Q, owner: number, photo: string, imageHash: string, old: Micros | null, next: Micros | null) {
  const oldDate = old === null ? null : toPgDate(old);
  // NULLs never conflict on the unique constraint: serialize the null album's get-or-create.
  if (oldDate === null || next === null) await q`SELECT pg_advisory_xact_lock(7340031, ${owner})`;
  const oldAlbum = await albumDateId(q, owner, oldDate);
  if (oldAlbum !== null) {
    const [{ e }] = await q`SELECT EXISTS (SELECT 1 FROM api_albumdate_photos ap JOIN api_photo p ON p.id = ap.photo_id
      WHERE ap.albumdate_id = ${oldAlbum} AND p.image_hash = ${imageHash}) AS e`;
    if (e) await q`DELETE FROM api_albumdate_photos WHERE albumdate_id = ${oldAlbum} AND photo_id = ${photo}::uuid`;
  }
  let album: number | null;
  if (next !== null) {
    const d = toPgDate(next);
    await q`INSERT INTO api_albumdate (title, date, favorited, owner_id) VALUES ('', ${d}::date, FALSE, ${owner}) ON CONFLICT (date, owner_id) DO NOTHING`;
    album = await albumDateId(q, owner, d);
  } else {
    album = await albumDateId(q, owner, null);
    if (album === null) {
      const [r] = await q`INSERT INTO api_albumdate (title, date, favorited, owner_id) VALUES ('', NULL, FALSE, ${owner}) RETURNING id`;
      album = r.id;
    }
  }
  if (album !== null) await q`INSERT INTO api_albumdate_photos (albumdate_id, photo_id) VALUES (${album}, ${photo}::uuid) ON CONFLICT DO NOTHING`;
}

/** camera_display / lens_display. */
function display(make: string | null, model: string | null): string | null {
  const ma = make || null;
  const mo = model || null;
  if (ma && mo) return mo.startsWith(ma) ? mo : `${ma} ${mo}`;
  return mo ?? ma;
}

/** PhotoSearch.recreate_search_captions + save. */
export async function recreateSearch(q: Q, photo: string, taggingModel: string) {
  const [srcRow] = await q`SELECT c.captions_json, p.video, p.is_screenshot, p.is_document, mf.path AS main_path
    FROM api_photo p LEFT JOIN api_photo_caption c ON c.photo_id = p.id LEFT JOIN api_file mf ON mf.hash = p.main_file_id
    WHERE p.id = ${photo}::uuid`;
  const parts: string[] = [];
  const c = srcRow.captions_json;
  if (c && typeof c === "object" && !Array.isArray(c)) {
    const tags = (c as Record<string, { tags?: unknown }>)[taggingModel]?.tags;
    if (Array.isArray(tags) && tags.length) parts.push(tags.map(valueStr).join(" "));
    for (const key of ["user_caption", "im2txt"]) {
      const v = (c as Record<string, unknown>)[key];
      if (v !== undefined && truthy(v as never)) parts.push(valueStr(v));
    }
  }
  const names: { name: string }[] = await q`SELECT pe.name FROM api_face f JOIN api_person pe ON pe.id = f.person_id
    WHERE f.photo_id = ${photo}::uuid ORDER BY f.id`;
  for (const n of names) parts.push(n.name);
  if (srcRow.main_path) parts.push(srcRow.main_path);
  const paths: { path: string }[] = await q`SELECT f.path FROM api_photo_files pf JOIN api_file f ON f.hash = pf.file_id
    WHERE pf.photo_id = ${photo}::uuid ORDER BY pf.id`;
  for (const p of paths) parts.push(p.path);
  if (srcRow.video) parts.push("type: video");
  if (srcRow.is_screenshot) parts.push("type: screenshot");
  if (srcRow.is_document) parts.push("type: document");
  const meta = await q.unsafe(`SELECT ${META_COLS} FROM api_photometadata WHERE photo_id = $1::uuid`, [photo]);
  const m = meta[0] as MetaRow | undefined;
  if (m) {
    const cam = display(m.camera_make, m.camera_model);
    if (cam) parts.push(cam);
    const lens = display(m.lens_make, m.lens_model);
    if (lens) parts.push(lens);
    if (Array.isArray(m.keywords) && m.keywords.length) parts.push(m.keywords.map(valueStr).join(" "));
  }
  const text = parts.map((x) => `${x} `).join("").trim();
  await q`INSERT INTO api_photo_search (photo_id, search_captions, search_location, created_at, updated_at)
    VALUES (${photo}::uuid, ${text}, NULL, now(), now())
    ON CONFLICT (photo_id) DO UPDATE SET search_captions = EXCLUDED.search_captions, updated_at = now()`;
}

/** Screenshot rule 2 inputs: PNG without camera metadata or GPS. */
export const hasCameraMetadata = (m: MetaRow) =>
  !!m.camera_model || (m.aperture !== null && m.aperture !== 0) || (m.iso !== null && m.iso !== 0) || (m.focal_length !== null && m.focal_length !== 0);

// ---- LongRunningJob bookkeeping ---------------------------------------------

/** update_job_result-style error record + the sticky failed flag. */
export const lrjRecordErrors = (jobId: string, result: unknown, failed: boolean) =>
  client`UPDATE api_longrunningjob SET result = ${JSON.stringify(result)}::text::jsonb, failed = failed OR ${failed} WHERE job_id = ${jobId} AND NOT cancelled`;

/** finish_job_if_complete once all work is done: finished exactly once. */
export async function lrjFinish(jobId: string): Promise<boolean> {
  const r = await client`UPDATE api_longrunningjob SET finished = TRUE, finished_at = now() WHERE job_id = ${jobId} AND NOT finished AND NOT cancelled RETURNING 1`;
  return r.length > 0;
}

export const lrjProgress = (jobId: string, current: number, target: number) =>
  client`UPDATE api_longrunningjob SET progress_current = ${current}, progress_target = ${target} WHERE job_id = ${jobId}`;

/** LongRunningJob.complete(). */
export const lrjComplete = (jobId: string) => client`UPDATE api_longrunningjob SET finished = TRUE, finished_at = now() WHERE job_id = ${jobId}`;

/** LongRunningJob.get_or_create_job: start it, creating it if needed. */
export async function lrjGetOrCreate(jobId: string, jobType: number, user: number) {
  await client`INSERT INTO api_longrunningjob (job_type, finished, failed, cancelled, job_id, queued_at, started_at, started_by_id, progress_current, progress_target)
    SELECT ${jobType}, FALSE, FALSE, FALSE, ${jobId}, now(), now(), ${user}, 0, 0
    WHERE NOT EXISTS (SELECT 1 FROM api_longrunningjob WHERE job_id = ${jobId})`;
  await client`UPDATE api_longrunningjob SET started_at = COALESCE(started_at, now()) WHERE job_id = ${jobId}`;
}

export async function photoCount(owner: number): Promise<number> {
  const [r] = await client`SELECT count(*)::int AS n FROM api_photo WHERE owner_id = ${owner}`;
  return r.n;
}
