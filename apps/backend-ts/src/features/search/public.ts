// Anonymous public pages: GET /api/public/albums/s/{slug}/,
// /api/public/albums/s/{slug}/photos/{photo}/ (api/views/public_albums.py)
// and /api/public/photo/{slug}/ (api/views/public_photos.py). Port of
// lp_api::search_sharing_public::public + lp_db::search_sharing_public::public.
// The routes resolve the user "optional"ly only for DRF's AllowAny
// behaviour: a bad Authorization header is still a 401.
import { sql } from "drizzle-orm";
import { row } from "~/lib/db";
import { ApiError } from "~/lib/errors";
import { json } from "~/lib/http";
import { groupByDate, pigFromRow, pigRows, type PigPhoto } from "~/lib/pig";
import type { QueryMap } from "~/lib/query";
import { drfTs } from "~/lib/time";
import { displayName, truthy } from "../timeline/common";

const SHARING_KEYS = ["share_location", "share_camera_info", "share_timestamps", "share_captions", "share_faces"] as const;
type Overrides = (boolean | null)[];

/** Share.get_effective_sharing_settings: all false, then the owner's defaults, then non-null per-share overrides. */
function effectiveSettings(ownerDefaults: unknown, overrides: Overrides): Record<string, unknown> {
  const s: Record<string, unknown> = {};
  for (const k of SHARING_KEYS) s[k] = false;
  if (ownerDefaults && typeof ownerDefaults === "object" && !Array.isArray(ownerDefaults)) {
    for (const [k, v] of Object.entries(ownerDefaults)) s[k] = v;
  }
  SHARING_KEYS.forEach((k, i) => {
    if (overrides[i] !== null && overrides[i] !== undefined) s[k] = overrides[i];
  });
  return s;
}

const setting = (s: Record<string, unknown>, k: string) => truthy(s[k]);

const MEDIA_SAFE = new Set(Array.from("_.-~/!*()'", (c) => c.charCodeAt(0)));

/** FieldFile.url for the default storage (`quote(path, safe="/~!*()'")`). */
function mediaUrl(name: string): string {
  let out = "";
  for (const b of new TextEncoder().encode(name.replaceAll("\\", "/"))) {
    const alnum = (b >= 48 && b <= 57) || (b >= 65 && b <= 90) || (b >= 97 && b <= 122);
    out += alnum || MEDIA_SAFE.has(b) ? String.fromCharCode(b) : "%" + b.toString(16).toUpperCase().padStart(2, "0");
  }
  return "/media/" + out.replace(/^\/+/, "");
}

const fileUrl = (name: string | null) => (name ? mediaUrl(name) : "");

interface PublicAlbum {
  id: number;
  title: string;
  owner_id: number;
  owner_username: string;
  owner_first_name: string;
  owner_last_name: string;
  owner_sharing_defaults: unknown;
  share_location: boolean | null;
  share_camera_info: boolean | null;
  share_timestamps: boolean | null;
  share_captions: boolean | null;
  share_faces: boolean | null;
}

/** An enabled, unexpired album share with its album and owner. */
const activeAlbum = (slug: string) =>
  row<PublicAlbum>(sql`SELECT a.id, a.title, u.id AS owner_id, u.username AS owner_username,
      u.first_name AS owner_first_name, u.last_name AS owner_last_name,
      u.public_sharing_defaults AS owner_sharing_defaults,
      s.share_location, s.share_camera_info, s.share_timestamps, s.share_captions, s.share_faces
    FROM api_albumusershare s JOIN api_albumuser a ON a.id = s.album_id
    JOIN api_user u ON u.id = a.owner_id
    WHERE s.enabled AND s.slug = ${slug} AND (s.expires_at IS NULL OR s.expires_at >= now())
    ORDER BY a.id LIMIT 1`);

const albumSettings = (a: PublicAlbum) =>
  effectiveSettings(a.owner_sharing_defaults, [a.share_location, a.share_camera_info, a.share_timestamps, a.share_captions, a.share_faces]);

export async function albumBySlug(slug: string, q: QueryMap) {
  const album = await activeAlbum(slug);
  if (!album) throw ApiError.statusOnly(404);
  const settings = albumSettings(album);
  const shareLocation = setting(settings, "share_location");
  const shareTimestamps = setting(settings, "share_timestamps");

  // The album's photos a visitor may see (Django checks neither removed nor the owner here).
  let photos = await pigRows(sql`WHERE EXISTS (SELECT 1 FROM api_albumuser_photos ap WHERE ap.photo_id = p.id AND ap.albumuser_id = ${album.id})
    AND NOT p.hidden AND NOT p.in_trashcan ORDER BY p.exif_timestamp DESC, p.id`);
  const date = shareTimestamps ? (photos.find((p) => p.date_drf !== null)?.date_drf ?? "") : "";
  const location = shareLocation ? (photos.find((p) => p.search_location)?.search_location ?? "") : "";
  if (q.flag("video")) photos = photos.filter((p) => p.video);
  else if (q.flag("photo")) photos = photos.filter((p) => !p.video);

  const groups: { date: string | null; location: string; items: PigPhoto[] }[] = shareTimestamps
    ? groupByDate(photos)
    : photos.length
      ? [{ date: null, location: "", items: photos.map(pigFromRow) }]
      : [];
  for (const g of groups) {
    for (const item of g.items) {
      if (!shareLocation) {
        item.exif_gps_lat = null;
        item.exif_gps_lon = null;
        item.location = "";
      }
      if (!shareTimestamps) {
        item.date = "";
        item.birthTime = "";
      }
    }
  }
  return {
    results: {
      id: String(album.id),
      title: album.title,
      owner: { id: album.owner_id, username: album.owner_username, first_name: album.owner_first_name, last_name: album.owner_last_name },
      date,
      location,
      grouped_photos: groups,
    },
    sharing_settings: settings,
  };
}

interface PublicPhotoRow {
  id: string;
  image_hash: string;
  video: boolean;
  exif_timestamp: string | null;
  exif_gps_lat: number | null;
  exif_gps_lon: number | null;
  geolocation_json: unknown;
  thumbnail_big: string | null;
  square_thumbnail: string | null;
  square_thumbnail_small: string | null;
  has_search: boolean;
  search_location: string | null;
  search_captions: string | null;
  captions_json: unknown;
  has_metadata: boolean;
  camera_make: string | null;
  camera_model: string | null;
  lens_make: string | null;
  lens_model: string | null;
  focal_length: number | null;
  aperture: number | null;
  iso: number | null;
  shutter_speed: string | null;
  width: number | null;
  height: number | null;
  faces: { id: number; image: string | null; name: string }[] | null;
}

/**
 * Everything PublicPhotoDetailSerializer reads, in one row; the faces (not
 * deleted, with a person or a cluster person) only when they are shared.
 */
const publicPhoto = (id: string, withFaces: boolean) =>
  row<PublicPhotoRow>(sql`SELECT p.id, p.image_hash, p.video, ${drfTs("p.exif_timestamp")} AS exif_timestamp,
      p.exif_gps_lat, p.exif_gps_lon, p.geolocation_json,
      t.thumbnail_big, t.square_thumbnail, t.square_thumbnail_small,
      (s.photo_id IS NOT NULL) AS has_search, s.search_location, s.search_captions,
      c.captions_json,
      (m.photo_id IS NOT NULL) AS has_metadata, m.camera_make, m.camera_model, m.lens_make, m.lens_model,
      m.focal_length, m.aperture, m.iso, m.shutter_speed, m.width, m.height,
      ${
        withFaces
          ? sql`(SELECT json_agg(json_build_object('id', f.id, 'image', f.image, 'name', COALESCE(pp.name, cp.name)) ORDER BY f.id)
              FROM api_face f LEFT JOIN api_person pp ON pp.id = f.person_id
              LEFT JOIN api_person cp ON cp.id = f.cluster_person_id
              WHERE f.photo_id = p.id AND NOT f.deleted AND (pp.id IS NOT NULL OR cp.id IS NOT NULL))`
          : sql`NULL::json`
      } AS faces
    FROM api_photo p
    LEFT JOIN api_thumbnail t ON t.photo_id = p.id
    LEFT JOIN api_photo_search s ON s.photo_id = p.id
    LEFT JOIN api_photo_caption c ON c.photo_id = p.id
    LEFT JOIN api_photometadata m ON m.photo_id = p.id
    WHERE p.id = ${id}::uuid`);

const captionsTruthy = (v: unknown) =>
  typeof v === "string" ? v.length > 0 : Array.isArray(v) ? v.length > 0 : !!v && typeof v === "object" && Object.keys(v).length > 0;

/** PublicPhotoDetailSerializer, fields in its Meta.fields order. */
function photoDetail(p: PublicPhotoRow, settings: Record<string, unknown>) {
  const shareLocation = setting(settings, "share_location");
  const shareCamera = setting(settings, "share_camera_info");
  const shareTimestamps = setting(settings, "share_timestamps");
  const shareCaptions = setting(settings, "share_captions");
  const shareFaces = setting(settings, "share_faces");
  const cam = shareCamera && p.has_metadata;
  return {
    image_hash: p.image_hash,
    video: p.video,
    square_thumbnail_url: fileUrl(p.square_thumbnail),
    big_thumbnail_url: fileUrl(p.thumbnail_big),
    small_square_thumbnail_url: fileUrl(p.square_thumbnail_small),
    exif_timestamp: shareTimestamps ? p.exif_timestamp : null,
    exif_gps_lat: shareLocation ? p.exif_gps_lat : null,
    exif_gps_lon: shareLocation ? p.exif_gps_lon : null,
    geolocation_json: shareLocation ? (p.geolocation_json ?? null) : null,
    search_location: shareLocation && p.has_search ? (p.search_location ?? "") : "",
    camera: cam ? displayName(p.camera_make, p.camera_model) : null,
    lens: cam ? displayName(p.lens_make, p.lens_model) : null,
    focal_length: cam ? p.focal_length : null,
    fstop: cam ? p.aperture : null,
    iso: cam ? p.iso : null,
    shutter_speed: cam ? p.shutter_speed : null,
    width: cam ? p.width : 0,
    height: cam ? p.height : 0,
    search_captions: shareCaptions && p.has_search ? (p.search_captions ?? "") : "",
    captions_json: shareCaptions && captionsTruthy(p.captions_json) ? p.captions_json : { im2txt: "" },
    people: shareFaces
      ? (p.faces ?? []).map((f) => ({ name: f.name, face_url: f.image ? mediaUrl(f.image) : null, face_id: f.id }))
      : [],
  };
}

const notFoundJson = (message: string) => json({ error: message }, 404);

export async function albumPhotoBySlug(slug: string, photoId: string) {
  const album = await activeAlbum(slug);
  if (!album) return notFoundJson("Album not found or not public");
  // Django tells a UUID from an image hash by shape (36 chars, 4 dashes); a
  // malformed UUID is a 500 there (its pk lookup raises), nothing matches here.
  let cond;
  if ([...photoId].length === 36 && photoId.split("-").length === 5) {
    const hex = photoId.replaceAll("-", "");
    if (!/^[0-9a-fA-F]{32}$/.test(hex)) return notFoundJson("Photo not found in album");
    cond = sql`p.id = ${hex}::uuid`;
  } else {
    cond = sql`p.image_hash = ${photoId}`;
  }
  const found = await row<{ id: string }>(sql`SELECT p.id FROM api_albumuser_photos ap JOIN api_photo p ON p.id = ap.photo_id
    WHERE ap.albumuser_id = ${album.id} AND NOT p.hidden AND NOT p.in_trashcan AND ${cond} ORDER BY p.id LIMIT 1`);
  if (!found) return notFoundJson("Photo not found in album");
  const settings = albumSettings(album);
  const photo = await publicPhoto(found.id, setting(settings, "share_faces"));
  if (!photo) return notFoundJson("Photo not found in album");
  return { results: photoDetail(photo, settings), sharing_settings: settings };
}

const sharedMediaUrl = (slug: string, kind: string) => `/api/public/photo/${slug}/media/${kind}/`;

/** A photo link: the detail without the content hash and hash-addressed URLs. */
export async function photoBySlug(slug: string) {
  const share = await row<{ slug: string; photo_id: string; owner_sharing_defaults: unknown }>(sql`SELECT s.slug, s.photo_id,
      u.public_sharing_defaults AS owner_sharing_defaults
    FROM api_photoshare s JOIN api_photo p ON p.id = s.photo_id JOIN api_user u ON u.id = p.owner_id
    WHERE s.enabled AND s.slug = ${slug} AND NOT p.hidden AND NOT p.in_trashcan AND NOT p.removed
    ORDER BY s.id LIMIT 1`);
  if (!share) throw ApiError.statusOnly(404);
  const settings = effectiveSettings(share.owner_sharing_defaults, [null, null, null, null, null]);
  const photo = await publicPhoto(share.photo_id, setting(settings, "share_faces"));
  if (!photo) throw ApiError.statusOnly(404);
  const {
    image_hash: _h,
    square_thumbnail_url: _a,
    big_thumbnail_url: _b,
    small_square_thumbnail_url: _c,
    ...data
  } = photoDetail(photo, settings);
  return {
    results: {
      ...data,
      people: data.people.map((p) => ({ name: p.name })),
      thumbnail_url: sharedMediaUrl(share.slug, "thumbnail"),
      video_url: photo.video ? sharedMediaUrl(share.slug, "video") : null,
    },
    sharing_settings: settings,
  };
}

