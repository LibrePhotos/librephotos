// PATCH /api/photos/edit/{hash|uuid}/ (PhotoEditViewSet.partial_update; port
// of lp_api::photo_edits::edit and lp_db::write::photo_edits::edit).
// PhotoEditSerializer.update only honours the media-category flags, the
// capture time and the GPS position; every other field is validated and
// ignored.
import { sql } from "drizzle-orm";
import { config } from "~/lib/config";
import { db, jsonbParam, pgArray, row, rows, type Tx } from "~/lib/db";
import { ApiError, type FieldError } from "~/lib/errors";
import { wakeWorker } from "~/lib/jobs";
import { parseClientDatetime } from "~/lib/time";
import type { User } from "~/lib/users";
import { drfBool, enqueueManyTx, metadataToDisk } from "./common";
import { extractLocalDateTime, microsToIso, microsToNaive, parseRules } from "./datetimeRules";
import { getMetadata } from "./exiftool";
import { editPhotoById, editTarget, type EditPhoto } from "./reads";

const DATETIME_FORMAT_ERR =
  "Datetime has wrong format. Use one of these formats instead: YYYY-MM-DDThh:mm[:ss[.uuuuuu]][+HH:MM|-HH:MM|Z].";

/** PhotoEditSerializer writable fields, in the order DRF validates (and reports) them. */
const FIELDS = [
  "image_hash",
  "hidden",
  "rating",
  "in_trashcan",
  "removed",
  "video",
  "exif_timestamp",
  "timestamp",
  "exif_gps_lat",
  "exif_gps_lon",
  "is_screenshot",
  "is_document",
] as const;

interface EditInput {
  /** undefined = absent, null = explicit null, else micro-epoch. */
  exifTimestamp?: bigint | null;
  gpsLat?: number | null;
  gpsLon?: number | null;
  isScreenshot?: boolean;
  isDocument?: boolean;
}

/** ISO text with offset (parseClientDatetime) -> micro-epoch. */
export function isoToMicros(iso: string): bigint {
  const m = /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(iso);
  if (!m) return BigInt(Date.parse(iso)) * 1000n;
  const ms = Date.parse(m[1] + m[3]);
  return BigInt(ms) * 1000n + BigInt((m[2] ?? "").padEnd(6, "0") || "0");
}

function floatField(v: unknown): number | null | string {
  const err = "A valid number is required.";
  if (v === null) return null;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const t = v.trim();
    // Rust's f64::from_str: decimal/exponent forms, inf/nan words (rejected as non-finite).
    if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return err;
    const f = Number(t);
    return Number.isFinite(f) ? f : err;
  }
  return err;
}

function datetimeField(v: unknown): bigint | null | { err: string } {
  if (v === null) return null;
  if (typeof v === "string") {
    const iso = parseClientDatetime(v);
    return iso === null ? { err: DATETIME_FORMAT_ERR } : isoToMicros(iso);
  }
  return { err: DATETIME_FORMAT_ERR };
}

/** DRF IntegerField over a model IntegerField (32-bit range validators). */
function integerField(v: unknown): string | undefined {
  const INVALID = "A valid integer is required.";
  let n: bigint;
  if (v === null) return "This field may not be null.";
  if (typeof v === "number") {
    if (!Number.isInteger(v) || Math.abs(v) >= 1e15) return INVALID;
    n = BigInt(v);
  } else if (typeof v === "string") {
    // int(re.sub(r"\.0*\s*$", "", data))
    let t = v.replace(/\s+$/, "");
    const i = t.lastIndexOf(".");
    if (i >= 0 && /^0*$/.test(t.slice(i + 1))) t = t.slice(0, i);
    t = t.trim().replaceAll("_", "");
    if (!/^[+-]?\d+$/.test(t)) return INVALID;
    n = BigInt(t);
  } else return INVALID;
  if (n > 2147483647n) return "Ensure this value is less than or equal to 2147483647.";
  if (n < -2147483648n) return "Ensure this value is greater than or equal to -2147483648.";
  return undefined;
}

function validate(body: Record<string, unknown>): EditInput {
  const input: EditInput = {};
  const errors: FieldError[] = [];
  const fail = (field: string, message: string) => errors.push({ field, message });
  for (const field of FIELDS) {
    if (!(field in body)) continue;
    const v = body[field];
    switch (field) {
      case "exif_timestamp":
      case "timestamp": {
        const r = datetimeField(v);
        if (r !== null && typeof r === "object") fail(field, r.err);
        else if (field === "exif_timestamp") input.exifTimestamp = r;
        break;
      }
      case "exif_gps_lat":
      case "exif_gps_lon": {
        const r = floatField(v);
        if (typeof r === "string") fail(field, r);
        else if (field === "exif_gps_lat") input.gpsLat = r;
        else input.gpsLon = r;
        break;
      }
      case "rating": {
        const e = integerField(v);
        if (e) fail(field, e);
        break;
      }
      case "image_hash": {
        if (v === null) fail(field, "This field may not be null.");
        else if (typeof v === "string") {
          const t = v.trim();
          if (!t) fail(field, "This field may not be blank.");
          else if ([...t].length > 64) fail(field, "Ensure this field has no more than 64 characters.");
        } else if (typeof v !== "number") fail(field, "Not a valid string.");
        break;
      }
      default: {
        if (v === null) {
          fail(field, "This field may not be null.");
          break;
        }
        const b = drfBool(v);
        if (b === undefined) fail(field, "Must be a valid boolean.");
        else if (field === "is_screenshot") input.isScreenshot = b;
        else if (field === "is_document") input.isDocument = b;
      }
    }
  }
  if (errors.length) throw ApiError.fields(400, errors);
  return input;
}

/** The serializer's data: DRF refuses anything but an object. */
function serializerData(body: unknown): Record<string, unknown> {
  if (body !== null && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  if (body === null) throw ApiError.validation("No data provided");
  const got = Array.isArray(body)
    ? "list"
    : typeof body === "string"
      ? "str"
      : typeof body === "boolean"
        ? "bool"
        : Number.isInteger(body)
          ? "int"
          : "float";
  throw ApiError.validation(`Invalid data. Expected a dictionary, but got ${got}.`);
}

/** PhotoEditSerializer output, in field order. */
const response = (p: EditPhoto) => ({
  image_hash: p.image_hash,
  hidden: p.hidden,
  rating: p.rating,
  in_trashcan: p.in_trashcan,
  removed: p.removed,
  video: p.video,
  exif_timestamp: p.exif_timestamp,
  timestamp: p.timestamp,
  exif_gps_lat: p.exif_gps_lat,
  exif_gps_lon: p.exif_gps_lon,
  is_screenshot: p.is_screenshot,
  is_document: p.is_document,
  category_source: p.category_source,
});

export async function patchPhoto(user: User, lookup: string, raw: unknown) {
  const photo = await editTarget(user.id, lookup);
  if (!photo) throw ApiError.notFound();
  const input = validate(serializerData(raw));

  if (input.isScreenshot !== undefined || input.isDocument !== undefined) {
    // _apply_category_override: save(update_fields=[...]) leaves last_modified alone.
    await db.execute(sql`UPDATE api_photo SET is_screenshot = COALESCE(${input.isScreenshot ?? null}::boolean, is_screenshot),
      is_document = COALESCE(${input.isDocument ?? null}::boolean, is_document), category_source = 'user' WHERE id = ${photo.id}`);
  }
  if (input.exifTimestamp !== undefined) await applyTimestamp(user, photo, input.exifTimestamp);
  if (typeof input.gpsLat === "number" && typeof input.gpsLon === "number") {
    try {
      await applyGps(photo, input.gpsLat, input.gpsLon);
    } catch (e) {
      console.warn(`Failed to update GPS location for photo: ${e}`);
    }
  }
  const fresh = await editPhotoById(photo.id);
  if (!fresh) throw ApiError.notFound();
  return response(fresh);
}

const day = (us: bigint | null) => {
  if (us === null) return null;
  const n = microsToNaive(us);
  return `${n.y}-${String(n.mo).padStart(2, "0")}-${String(n.d).padStart(2, "0")}`;
};

/**
 * _apply_exif_timestamp: save the user's `timestamp`, then extract_date_time
 * (rules + day album). Like Django, the saved timestamp stays when the
 * extraction fails afterwards.
 */
async function applyTimestamp(user: User, photo: EditPhoto, timestamp: bigint | null) {
  const tsIso = timestamp === null ? null : microsToIso(timestamp);
  await db.execute(sql`UPDATE api_photo SET "timestamp" = ${tsIso}::timestamptz, last_modified = now() WHERE id = ${photo.id}`);
  const file = photo.main_file_path;
  if (!file) throw ApiError.internal("photo has no main file");
  let extracted: bigint | null;
  try {
    extracted = await extractLocalDateTime(
      parseRules(user.datetimeRules),
      { path: file, gpsLat: photo.exif_gps_lat, gpsLon: photo.exif_gps_lon, userDefaultTz: user.defaultTimezone, userDefined: timestamp },
      (tags) => getMetadata(file, tags, true),
    );
  } catch (e) {
    throw ApiError.internal(e);
  }
  const old = photo.timestamp_us === null ? null : BigInt(photo.timestamp_us);
  const queued = metadataToDisk(user) && timestamp !== old;
  await db.transaction(async (tx) => {
    await setExifTimestamp(tx, photo, photo.exif_day, extracted);
    if (queued) await enqueueManyTx(tx, "metadata.write", [{ photo_id: photo.id, fields: ["timestamp"] }]);
  });
  if (queued) wakeWorker();
}

/** The tail of extract_date_time: store exif_timestamp and move the photo between day albums. */
async function setExifTimestamp(tx: Tx, photo: EditPhoto, oldDay: string | null, extracted: bigint | null) {
  // get_album_date(date, owner) is a .get(): exactly one row or nothing.
  const old = await rows<{ id: number }>(
    sql`SELECT id FROM api_albumdate WHERE date IS NOT DISTINCT FROM ${oldDay}::date AND owner_id = ${photo.owner_id} LIMIT 2`,
    tx,
  );
  if (old.length === 1) {
    await tx.execute(sql`DELETE FROM api_albumdate_photos WHERE albumdate_id = ${old[0].id} AND photo_id = ${photo.id}
      AND EXISTS (SELECT 1 FROM api_albumdate_photos ap JOIN api_photo p ON p.id = ap.photo_id
                  WHERE ap.albumdate_id = ${old[0].id} AND p.image_hash = ${photo.image_hash})`);
  }
  const newDay = day(extracted);
  let album = (
    await row<{ id: number }>(
      sql`SELECT id FROM api_albumdate WHERE date IS NOT DISTINCT FROM ${newDay}::date AND owner_id = ${photo.owner_id} ORDER BY id LIMIT 1`,
      tx,
    )
  )?.id;
  album ??= (await row<{ id: number }>(
    sql`INSERT INTO api_albumdate (title, date, favorited, location, owner_id)
      VALUES ('', ${newDay}::date, FALSE, NULL, ${photo.owner_id}) RETURNING id`,
    tx,
  ))!.id;
  await tx.execute(sql`INSERT INTO api_albumdate_photos (albumdate_id, photo_id) SELECT ${album}, ${photo.id}
    WHERE NOT EXISTS (SELECT 1 FROM api_albumdate_photos WHERE albumdate_id = ${album} AND photo_id = ${photo.id})`);
  await tx.execute(sql`UPDATE api_photo SET exif_timestamp = ${extracted === null ? null : microsToIso(extracted)}::timestamptz,
    last_modified = now() WHERE id = ${photo.id}`);
}

/**
 * Reverse geocoding (lp_tasks::geocode::reverse_geocode). Off (FEATURE_REVERSE_GEOCODING=0)
 * it answers {} like Django's. TODO(merge): call the geocode area's provider
 * client here once it is ported; until then a configured geocoder is not used.
 */
async function reverseGeocode(_lat: number, _lon: number): Promise<Record<string, unknown>> {
  if (config.features.reverseGeocoding) console.warn("reverse geocoding is not ported to librephotos-ts yet");
  return {};
}

/** _apply_gps_location: the coordinates are saved before the geocoder runs. */
async function applyGps(photo: EditPhoto, lat: number, lon: number) {
  const oldPlaces = await db.transaction(async (tx) => {
    const r = await rows<{ id: number }>(
      sql`SELECT DISTINCT albumplace_id AS id FROM api_albumplace_photos WHERE photo_id = ${photo.id} ORDER BY 1`,
      tx,
    );
    await tx.execute(sql`UPDATE api_photo SET exif_gps_lat = ${lat}::float8, exif_gps_lon = ${lon}::float8, last_modified = now()
      WHERE id = ${photo.id}`);
    return r.map((x) => x.id);
  });
  const geo = await reverseGeocode(lat, lon);
  if (!Object.keys(geo).length) {
    console.warn("Reverse geocoding returned no result for provided coordinates");
    return;
  }
  await applyGeocode(photo, geo, oldPlaces);
}

/** PhotoSearch.update_search_location */
function searchLocationOf(geo: Record<string, unknown>): string {
  if ("address" in geo) {
    const a = geo.address;
    return typeof a === "string" ? a : a === null ? "" : JSON.stringify(a);
  }
  if (Array.isArray(geo.features)) {
    return geo.features
      .map((f) => (f && typeof f === "object" ? (f as Record<string, unknown>).text : undefined))
      .filter((t) => t !== undefined && t !== null && t !== "" && t !== false && t !== 0)
      .map((t) => (typeof t === "string" ? t : JSON.stringify(t)))
      .join(", ");
  }
  return "";
}

/** The rest of _apply_gps_location once the geocoder answered. */
async function applyGeocode(photo: EditPhoto, geo: Record<string, unknown>, oldPlaces: number[]) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`INSERT INTO api_photo_search (photo_id, search_captions, search_location, created_at, updated_at)
      VALUES (${photo.id}, NULL, ${searchLocationOf(geo)}, now(), now())
      ON CONFLICT (photo_id) DO UPDATE SET search_location = EXCLUDED.search_location, updated_at = now()`);
    if (oldPlaces.length) {
      await tx.execute(sql`DELETE FROM api_albumplace_photos WHERE photo_id = ${photo.id} AND albumplace_id = ANY(${pgArray(oldPlaces, "int")})`);
      await tx.execute(sql`UPDATE api_albumplace SET last_modified = now() WHERE id = ANY(${pgArray(oldPlaces, "int")})`);
    }
    if (Array.isArray(geo.features)) {
      const n = geo.features.length;
      for (const [level, feature] of geo.features.entries()) {
        const text = feature && typeof feature === "object" ? (feature as Record<string, unknown>).text : undefined;
        if (text === undefined) continue;
        const title = typeof text === "string" ? text : JSON.stringify(text);
        if (title.length && /^\p{N}+$/u.test(title)) continue;
        let place = (
          await row<{ id: number }>(sql`SELECT id FROM api_albumplace WHERE title = ${title} AND owner_id = ${photo.owner_id} ORDER BY id LIMIT 1`, tx)
        )?.id;
        place ??= (await row<{ id: number }>(
          sql`INSERT INTO api_albumplace (title, geolocation_level, favorited, owner_id, last_modified)
            VALUES (${title}, NULL, FALSE, ${photo.owner_id}, now()) RETURNING id`,
          tx,
        ))!.id;
        await tx.execute(sql`UPDATE api_albumplace SET geolocation_level = ${n - level} WHERE id = ${place}
          AND NOT EXISTS (SELECT 1 FROM api_albumplace_photos ap JOIN api_photo p ON p.id = ap.photo_id
                          WHERE ap.albumplace_id = ${place} AND p.image_hash = ${photo.image_hash})`);
        await tx.execute(sql`INSERT INTO api_albumplace_photos (albumplace_id, photo_id) SELECT ${place}, ${photo.id}
          WHERE NOT EXISTS (SELECT 1 FROM api_albumplace_photos WHERE albumplace_id = ${place} AND photo_id = ${photo.id})`);
        await tx.execute(sql`UPDATE api_albumplace SET last_modified = now() WHERE id = ${place}`);
      }
    }
    await tx.execute(sql`UPDATE api_photo SET geolocation_json = ${jsonbParam(geo)}, last_modified = now() WHERE id = ${photo.id}`);
  });
}
