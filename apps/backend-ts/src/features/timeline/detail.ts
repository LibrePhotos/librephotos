// GET /api/photos/{hash|uuid}/ (PhotoSerializer minus exif_json) and
// GET /api/photos/{hash|uuid}/albums/ (PhotoViewSet.albums). Port of
// lp_api::timeline_photos::detail + lp_db::timeline_photos::detail: the
// detail is one row (scalar columns plus json_agg for faces, files, shares,
// embedded media and stacks), the similar photos one sidecar call plus one
// query; the albums one statement.
import { sql } from "drizzle-orm";
import { pgArray, row, rows } from "~/lib/db";
import { ApiError } from "~/lib/errors";
import { VALID_STACK_TYPES_SQL } from "~/lib/pig";
import { ownedBy, visibleManager, visibleTo } from "~/lib/scope";
import { drfTs } from "~/lib/time";
import type { User } from "~/lib/users";
import { semanticModel, semanticModelProduced, similarityHashes, similarThresholdFor } from "../search/sidecar";
import { displayName, fileUrl, lookupSql, mediaUrl, megapixels, parseLookup, resolution, truthy } from "./common";

interface FaceJson {
  id: number;
  image: string | null;
  person: string | null;
  cluster_person: string | null;
  classification_person: string | null;
  cluster_probability: number;
  classification_probability: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
}

interface StackJson {
  id: string;
  stack_type: string;
  primary_photo_id: string | null;
  photos: { id: string; image_hash: string; has_thumbnail: boolean; size: number; width: number; height: number }[] | null;
}

interface DetailRow {
  id: string;
  exif_gps_lat: number | null;
  exif_gps_lon: number | null;
  exif_timestamp: string | null;
  geolocation_json: unknown;
  image_hash: string;
  rating: number;
  hidden: boolean;
  public: boolean;
  removed: boolean;
  in_trashcan: boolean;
  video: boolean;
  size: number;
  local_orientation: number;
  main_file_id: string | null;
  clip_embeddings: unknown;
  clip_embeddings_model: string | null;
  owner_id: number;
  owner_username: string;
  owner_first_name: string;
  owner_last_name: string;
  captions_json: unknown;
  search_captions: string;
  search_location: string;
  thumbnail_big: string;
  square_thumbnail: string;
  square_thumbnail_small: string;
  has_metadata: boolean;
  md_width: number | null;
  md_height: number | null;
  md_focal_length: number | null;
  md_aperture: number | null;
  md_iso: number | null;
  md_shutter_speed: string | null;
  md_camera_make: string | null;
  md_camera_model: string | null;
  md_lens_make: string | null;
  md_lens_model: string | null;
  md_focal_length_35mm: number | null;
  md_date_taken: string | null;
  md_gps_latitude: number | null;
  md_gps_longitude: number | null;
  md_rating: number | null;
  md_source: string | null;
  md_version: number | null;
  has_edits: boolean;
  has_ocr: boolean;
  ocr_text: string | null;
  ocr_blocks: unknown;
  ocr_source_width: number | null;
  ocr_source_height: number | null;
  people: FaceJson[] | null;
  files: { hash: string; path: string; type: number }[] | null;
  shared_to: number[] | null;
  embedded: { hash: string; type: number }[] | null;
  stacks: StackJson[] | null;
}

// Many-to-many reads come back in insertion order of the through rows on
// Postgres (Django's unordered .all()), hence ORDER BY the through id.
const DETAIL_SELECT = sql.raw(`p.id, p.exif_gps_lat, p.exif_gps_lon, p.geolocation_json,
  p.image_hash, p.rating, p.hidden, p.public, p.removed, p.in_trashcan, p.video, p.size,
  p.local_orientation, p.main_file_id, p.clip_embeddings, p.clip_embeddings_model,
  u.id AS owner_id, u.username AS owner_username, u.first_name AS owner_first_name, u.last_name AS owner_last_name,
  cap.captions_json, COALESCE(s.search_captions, '') AS search_captions, COALESCE(s.search_location, '') AS search_location,
  t.thumbnail_big, t.square_thumbnail, t.square_thumbnail_small,
  (md.id IS NOT NULL) AS has_metadata, md.width AS md_width, md.height AS md_height,
  md.focal_length AS md_focal_length, md.aperture AS md_aperture, md.iso AS md_iso,
  md.shutter_speed AS md_shutter_speed, md.camera_make AS md_camera_make,
  md.camera_model AS md_camera_model, md.lens_make AS md_lens_make, md.lens_model AS md_lens_model,
  md.focal_length_35mm AS md_focal_length_35mm,
  md.gps_latitude AS md_gps_latitude, md.gps_longitude AS md_gps_longitude, md.rating AS md_rating,
  md.source AS md_source, md.version AS md_version,
  EXISTS (SELECT 1 FROM api_metadataedit me WHERE me.photo_id = p.id) AS has_edits,
  (o.photo_id IS NOT NULL) AS has_ocr, o.text AS ocr_text, o.blocks AS ocr_blocks,
  o.source_width AS ocr_source_width, o.source_height AS ocr_source_height,
  (SELECT json_agg(json_build_object('id', f.id, 'image', f.image,
      'person', CASE WHEN f.person_id IS NOT NULL THEN COALESCE(fp.name, '') END,
      'cluster_person', CASE WHEN f.cluster_person_id IS NOT NULL THEN COALESCE(fc.name, '') END,
      'classification_person', CASE WHEN f.classification_person_id IS NOT NULL THEN COALESCE(fl.name, '') END,
      'cluster_probability', f.cluster_probability, 'classification_probability', f.classification_probability,
      'top', f.location_top, 'bottom', f.location_bottom, 'left', f.location_left, 'right', f.location_right) ORDER BY f.id)
    FROM api_face f LEFT JOIN api_person fp ON fp.id = f.person_id
    LEFT JOIN api_person fc ON fc.id = f.cluster_person_id
    LEFT JOIN api_person fl ON fl.id = f.classification_person_id
    WHERE f.photo_id = p.id AND NOT f.deleted) AS people,
  (SELECT json_agg(json_build_object('hash', fi.hash, 'path', fi.path, 'type', fi.type) ORDER BY pf.id)
    FROM api_photo_files pf JOIN api_file fi ON fi.hash = pf.file_id WHERE pf.photo_id = p.id) AS files,
  (SELECT json_agg(st.user_id ORDER BY st.id) FROM api_photo_shared_to st WHERE st.photo_id = p.id) AS shared_to,
  (SELECT json_agg(json_build_object('hash', ef.hash, 'type', ef.type) ORDER BY em.id)
    FROM api_file_embedded_media em JOIN api_file ef ON ef.hash = em.to_file_id
    WHERE em.from_file_id = p.main_file_id AND ef.type IN (1, 2)) AS embedded,
  (SELECT json_agg(json_build_object('id', sk.id, 'stack_type', sk.stack_type, 'primary_photo_id', sk.primary_photo_id,
      'photos', (SELECT json_agg(json_build_object('id', sp.id, 'image_hash', sp.image_hash,
          'has_thumbnail', (COALESCE(sth.square_thumbnail_small, '') <> ''), 'size', sp.size,
          'width', COALESCE(smd.width, 0), 'height', COALESCE(smd.height, 0)) ORDER BY sps.id)
        FROM api_photo_stacks sps JOIN api_photo sp ON sp.id = sps.photo_id
        LEFT JOIN api_thumbnail sth ON sth.photo_id = sp.id
        LEFT JOIN api_photometadata smd ON smd.photo_id = sp.id
        WHERE sps.photostack_id = sk.id)) ORDER BY sk.created_at DESC, sk.id)
    FROM api_photo_stacks ps JOIN api_photostack sk ON sk.id = ps.photostack_id
    WHERE ps.photo_id = p.id AND sk.stack_type IN ${VALID_STACK_TYPES_SQL}) AS stacks`);

/** `get_captions_json`: the stored captions when non-empty, else {"im2txt": ""}. */
function captions(v: unknown): unknown {
  return truthy(v) && typeof v !== "number" && typeof v !== "boolean" ? v : { im2txt: "" };
}

/** Python float(x) on a JSON value. */
function pyFloat(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    const t = v.trim();
    if (!t || !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$|^[+-]?(inf|infinity|nan)$/i.test(t)) return null;
    return Number(t.replace(/^([+-]?)inf(inity)?$/i, "$1Infinity"));
  }
  return null;
}

const unit = (v: number) => {
  const x = v > 0 ? v : 0;
  return x < 1 ? x : 1;
};

/** `get_ocr`'s block normalization: pixel quads to [0, 1] fractions; malformed blocks skipped. */
function ocrBlocks(blocks: unknown, width: number, height: number): unknown[] {
  const out: unknown[] = [];
  if (!Array.isArray(blocks) || !(width > 0 && height > 0)) return out;
  outer: for (const block of blocks) {
    if (!block || typeof block !== "object" || Array.isArray(block)) continue;
    const obj = block as Record<string, unknown>;
    const text = obj.text ?? null;
    const quad = obj.box;
    if (!Array.isArray(quad) || !truthy(text) || quad.length !== 4) continue;
    const normalized: number[][] = [];
    for (const pt of quad) {
      if (!Array.isArray(pt) || pt.length !== 2) continue outer;
      const x = pyFloat(pt[0]);
      const y = pyFloat(pt[1]);
      if (x === null || y === null) continue outer;
      normalized.push([unit(x / width), unit(y / height)]);
    }
    out.push({ text, box: normalized, confidence: obj.confidence ?? null });
  }
  return out;
}

const FILE_TYPES: Record<number, string> = { 1: "image", 2: "video", 4: "raw", 3: "metadata" };
const STACK_TYPES: Record<string, string> = {
  burst: "Burst Sequence",
  bracket: "Exposure Bracket",
  manual: "Manual Stack",
  raw_jpeg: "RAW + JPEG Pair (Deprecated)",
  live_photo: "Live Photo (Deprecated)",
};

function people(faces: FaceJson[] | null) {
  return (faces ?? []).map((f) => {
    let name = "";
    let type = "";
    let probability: number = 0;
    if (f.person !== null) [name, type, probability] = [f.person, "user", 1];
    else if (f.cluster_person !== null) [name, type, probability] = [f.cluster_person, "cluster", f.cluster_probability];
    else if (f.classification_person !== null)
      [name, type, probability] = [f.classification_person, "classification", f.classification_probability];
    return {
      name,
      type,
      probability,
      location: { top: f.top, bottom: f.bottom, left: f.left, right: f.right },
      face_url: f.image ? mediaUrl(f.image) : "",
      face_id: f.id,
    };
  });
}

/** ClipEmbedding::decode: a JSON array of numbers, or a string holding one. */
function decodeEmbedding(v: unknown): number[] | null {
  if (typeof v === "string") {
    try {
      const inner = JSON.parse(v);
      return Array.isArray(inner) ? decodeEmbedding(inner) : null;
    } catch {
      return null;
    }
  }
  if (!Array.isArray(v) || !v.every((x) => typeof x === "number")) return null;
  return v as number[];
}

async function similarPhotos(r: DetailRow, viewer: number | null) {
  // The index holds only the selected model's embeddings.
  const model = await semanticModel();
  if (!semanticModelProduced(model, r.clip_embeddings_model)) return [];
  if (!truthy(r.clip_embeddings)) return [];
  const emb = decodeEmbedding(r.clip_embeddings);
  if (!emb) return [];
  const hashes = await similarityHashes(r.owner_id, emb, null, similarThresholdFor(model), false);
  if (!hashes.length) return [];
  const rs = await rows<{ image_hash: string; video: boolean }>(sql`SELECT p.image_hash, p.video FROM api_photo p
    WHERE ${ownedBy("p", r.owner_id)} AND ${visibleTo("p", viewer)} AND p.image_hash = ANY(${pgArray(hashes, "text")})
    ORDER BY p.exif_timestamp DESC, p.id`);
  return rs.map((x) => ({ image_hash: x.image_hash, type: x.video ? "video" : "image" }));
}

export async function photoDetail(user: User | null, rawId: string) {
  const viewer = user?.id ?? null;
  const r = await row<DetailRow>(sql`SELECT ${DETAIL_SELECT}, ${drfTs("p.exif_timestamp")} AS exif_timestamp,
      ${drfTs("md.date_taken")} AS md_date_taken
    FROM api_photo p JOIN api_user u ON u.id = p.owner_id
    JOIN api_thumbnail t ON t.photo_id = p.id
    LEFT JOIN api_photo_caption cap ON cap.photo_id = p.id
    LEFT JOIN api_photo_search s ON s.photo_id = p.id
    LEFT JOIN api_photometadata md ON md.photo_id = p.id
    LEFT JOIN api_photo_ocr o ON o.photo_id = p.id
    WHERE ${lookupSql(parseLookup(rawId), "p")} AND ${visibleManager("p")} AND ${visibleTo("p", viewer)}
    ORDER BY p.exif_timestamp DESC, p.id LIMIT 1`);
  if (!r) throw ApiError.notFound();
  const similar = await similarPhotos(r, viewer);

  const files = r.files ?? [];
  const stacks = (r.stacks ?? []).map((st) => {
    const photos = (st.photos ?? []).map((sp) => ({
      id: sp.id,
      image_hash: sp.image_hash,
      is_primary: sp.id === st.primary_photo_id,
      thumbnail_url: sp.has_thumbnail ? `/media/square_thumbnails_small/${sp.image_hash}` : null,
      size: sp.size,
      width: sp.width,
      height: sp.height,
    }));
    return {
      id: st.id,
      type: st.stack_type,
      type_display: STACK_TYPES[st.stack_type] ?? "",
      photo_count: photos.length,
      is_primary: st.primary_photo_id === r.id,
      photos,
    };
  });
  const md = r.has_metadata;
  return {
    id: r.id,
    exif_gps_lat: r.exif_gps_lat,
    exif_gps_lon: r.exif_gps_lon,
    exif_timestamp: r.exif_timestamp,
    captions_json: captions(r.captions_json),
    search_captions: r.search_captions,
    search_location: r.search_location,
    big_thumbnail_url: fileUrl(r.thumbnail_big),
    square_thumbnail_url: fileUrl(r.square_thumbnail),
    small_square_thumbnail_url: fileUrl(r.square_thumbnail_small),
    geolocation_json: r.geolocation_json ?? null,
    people: people(r.people),
    image_hash: r.image_hash,
    image_path: files.map((f) => f.path),
    rating: r.rating,
    hidden: r.hidden,
    public: r.public,
    removed: r.removed,
    in_trashcan: r.in_trashcan,
    shared_to: r.shared_to ?? [],
    similar_photos: similar,
    video: r.video,
    owner: { id: r.owner_id, username: r.owner_username, first_name: r.owner_first_name, last_name: r.owner_last_name },
    size: Number(r.size),
    height: md ? r.md_height : 0,
    width: md ? r.md_width : 0,
    focal_length: r.md_focal_length,
    fstop: r.md_aperture,
    iso: r.md_iso,
    shutter_speed: r.md_shutter_speed,
    lens: displayName(r.md_lens_make, r.md_lens_model),
    camera: displayName(r.md_camera_make, r.md_camera_model),
    focalLength35Equivalent: r.md_focal_length_35mm,
    digitalZoomRatio: null,
    subjectDistance: null,
    embedded_media:
      r.main_file_id !== null ? (r.embedded ?? []).map((m) => ({ id: m.hash, type: m.type === 2 ? "video" : "image" })) : [],
    file_variants:
      files.length > 1
        ? files.map((f) => ({
            hash: f.hash,
            path: f.path,
            type: FILE_TYPES[f.type] ?? "unknown",
            type_id: f.type,
            is_main: r.main_file_id === f.hash,
            filename: f.path ? f.path.slice(f.path.lastIndexOf("/") + 1) : null,
          }))
        : null,
    stacks: stacks.length ? stacks : null,
    metadata: md
      ? {
          camera_display: displayName(r.md_camera_make, r.md_camera_model),
          lens_display: displayName(r.md_lens_make, r.md_lens_model),
          aperture: r.md_aperture,
          shutter_speed: r.md_shutter_speed,
          iso: r.md_iso,
          focal_length: r.md_focal_length,
          focal_length_35mm: r.md_focal_length_35mm,
          resolution: resolution(r.md_width, r.md_height),
          megapixels: megapixels(r.md_width, r.md_height),
          date_taken: r.md_date_taken,
          has_location: r.md_gps_latitude !== null && r.md_gps_longitude !== null,
          rating: r.md_rating,
          source: r.md_source ?? "",
          version: r.md_version ?? 1,
          has_edits: r.has_edits,
        }
      : null,
    ocr:
      viewer === r.owner_id && r.has_ocr
        ? { text: r.ocr_text ?? "", blocks: ocrBlocks(r.ocr_blocks, r.ocr_source_width ?? 0, r.ocr_source_height ?? 0) }
        : null,
    local_orientation: r.local_orientation,
  };
}

interface UserJson {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
}

interface PhotoAlbumJson {
  id: number;
  title: string;
  created_on: string;
  favorited: boolean;
  cover: { image_hash: string; rating: number; hidden: boolean; exif_timestamp: string | null; public: boolean; video: boolean } | null;
  owner: UserJson;
  shared_to: UserJson[] | null;
  photo_count: number;
  share: {
    enabled: boolean;
    slug: string | null;
    expires_at: string | null;
    share_location: boolean | null;
    share_camera_info: boolean | null;
    share_timestamps: boolean | null;
    share_captions: boolean | null;
    share_faces: boolean | null;
  } | null;
}

const userJson = (a: string) =>
  `json_build_object('id', ${a}.id, 'username', ${a}.username, 'first_name', ${a}.first_name, 'last_name', ${a}.last_name)`;

/**
 * PhotoViewSet.albums: 404 (no body) when the photo is not visible to the
 * requester (own, shared, public, or in one of their own or shared-to-them
 * albums); else the requester's own and shared-to-them albums holding it.
 */
export async function photoAlbums(user: User | null, rawId: string) {
  const viewer = user?.id ?? null;
  const v = viewer ?? -1;
  const inUserAlbum = (al: string) =>
    sql.raw(`(${al}.owner_id = ${v} OR EXISTS (SELECT 1 FROM api_albumuser_shared_to ust WHERE ust.albumuser_id = ${al}.id AND ust.user_id = ${v}))`);
  const albumVisible =
    viewer !== null
      ? sql` OR EXISTS (SELECT 1 FROM api_albumuser_photos cap JOIN api_albumuser ca ON ca.id = cap.albumuser_id
          WHERE cap.photo_id = p.id AND ${inUserAlbum("ca")})`
      : sql``;
  const albums =
    viewer !== null
      ? sql`(SELECT json_agg(json_build_object('id', a.id, 'title', a.title, 'created_on', ${drfTs("a.created_on")},
          'favorited', a.favorited,
          'cover', (SELECT json_build_object('image_hash', cp.image_hash, 'rating', cp.rating, 'hidden', cp.hidden,
              'exif_timestamp', ${drfTs("cp.exif_timestamp")}, 'public', cp.public, 'video', cp.video)
            FROM api_photo cp WHERE cp.id = COALESCE(a.cover_photo_id,
              (SELECT fap.photo_id FROM api_albumuser_photos fap WHERE fap.albumuser_id = a.id
               AND fap.photo_id IS NOT NULL ORDER BY fap.photo_id LIMIT 1))),
          'owner', ${sql.raw(userJson("au"))},
          'shared_to', (SELECT json_agg(${sql.raw(userJson("su"))} ORDER BY sst.id) FROM api_albumuser_shared_to sst
            JOIN api_user su ON su.id = sst.user_id WHERE sst.albumuser_id = a.id),
          'photo_count', (SELECT count(*) FROM api_albumuser_photos cnt JOIN api_photo cph ON cph.id = cnt.photo_id
            WHERE cnt.albumuser_id = a.id),
          'share', (SELECT json_build_object('enabled', sh.enabled, 'slug', sh.slug, 'expires_at', ${drfTs("sh.expires_at")},
              'share_location', sh.share_location, 'share_camera_info', sh.share_camera_info,
              'share_timestamps', sh.share_timestamps, 'share_captions', sh.share_captions, 'share_faces', sh.share_faces)
            FROM api_albumusershare sh WHERE sh.album_id = a.id)) ORDER BY a.id)
        FROM api_albumuser a JOIN api_user au ON au.id = a.owner_id
        WHERE ${inUserAlbum("a")} AND EXISTS (SELECT 1 FROM api_albumuser_photos aap
          WHERE aap.albumuser_id = a.id AND aap.photo_id = ph.id))`
      : sql`NULL::json`;
  const r = await row<{ albums: PhotoAlbumJson[] | null }>(sql`WITH ph AS (SELECT p.id FROM api_photo p
      WHERE ${lookupSql(parseLookup(rawId), "p")} AND (${visibleTo("p", viewer)}${albumVisible}) ORDER BY p.id LIMIT 1)
    SELECT ${albums} AS albums FROM ph`);
  // Django answers Response(status=404): no body.
  if (!r) return new Response(null, { status: 404 });
  return {
    results: (r.albums ?? []).map((a) => ({
      id: a.id,
      cover_photo: a.cover,
      created_on: a.created_on,
      favorited: a.favorited,
      title: a.title,
      shared_to: a.shared_to ?? [],
      owner: a.owner,
      photo_count: a.photo_count,
      public: a.share?.enabled ?? false,
      public_slug: a.share?.slug ?? "",
      public_expires_at: a.share?.expires_at ?? null,
      public_sharing_options: a.share
        ? {
            share_location: a.share.share_location,
            share_camera_info: a.share.share_camera_info,
            share_timestamps: a.share.share_timestamps,
            share_captions: a.share.share_captions,
            share_faces: a.share.share_faces,
          }
        : null,
    })),
  };
}
