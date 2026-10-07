// GET / PATCH /api/photos/{id}/metadata (PhotoMetadataViewSet). Port of
// lp_api::timeline_photos::metadata, lp_db::timeline_photos::metadata and
// lp_db::write::timeline_photos: the get_or_create both methods do, the
// PATCH (one MetadataEdit per changed field, source = user_edit,
// version + 1) and sync_tags_from_keywords for a keyword edit.
import { sql, type SQL } from "drizzle-orm";
import { db, jsonbParam, pgArray, row, rows, type Db, type Tx } from "~/lib/db";
import { ApiError, type FieldError } from "~/lib/errors";
import { jsonBody } from "~/lib/http";
import { drfTs, parseClientDatetime } from "~/lib/time";
import type { User } from "~/lib/users";
import { displayName, lookupSql, megapixels, parseLookup, resolution } from "./common";

interface MetadataPhoto {
  id: string;
  owner_id: number;
}

/** `_get_photo`: the id must look like `[0-9a-f-]+`; staff see every photo, others their own. */
async function findPhoto(user: User, id: string): Promise<MetadataPhoto> {
  if (!/^[0-9a-f-]+$/.test(id)) throw ApiError.notFound();
  const scope = user.isStaff ? sql`` : sql` AND p.owner_id = ${user.id}`;
  const p = await row<MetadataPhoto>(
    sql`SELECT p.id, p.owner_id FROM api_photo p WHERE ${lookupSql(parseLookup(id), "p")}${scope} ORDER BY p.id LIMIT 1`,
  );
  if (!p) throw ApiError.notFound("No Photo matches the given query.");
  return p;
}

const METADATA_COLUMNS = sql.raw(`id, photo_id, aperture, shutter_speed, shutter_speed_seconds, iso,
  focal_length, focal_length_35mm, exposure_compensation, flash_fired, metering_mode, white_balance,
  camera_make, camera_model, lens_make, lens_model, serial_number, width, height, orientation,
  color_space, bit_depth, date_taken_subsec, timezone_offset,
  gps_latitude, gps_longitude, gps_altitude, location_country, location_state, location_city,
  location_address, title, caption, keywords, rating, copyright, creator, source, version`);

interface MetadataRow {
  id: string;
  photo_id: string;
  aperture: number | null;
  shutter_speed: string | null;
  shutter_speed_seconds: number | null;
  iso: number | null;
  focal_length: number | null;
  focal_length_35mm: number | null;
  exposure_compensation: number | null;
  flash_fired: boolean | null;
  metering_mode: string | null;
  white_balance: string | null;
  camera_make: string | null;
  camera_model: string | null;
  lens_make: string | null;
  lens_model: string | null;
  serial_number: string | null;
  width: number | null;
  height: number | null;
  orientation: number | null;
  color_space: string | null;
  bit_depth: number | null;
  date_taken: string | null;
  date_taken_subsec: string | null;
  date_modified: string | null;
  timezone_offset: string | null;
  gps_latitude: number | null;
  gps_longitude: number | null;
  gps_altitude: number | null;
  location_country: string | null;
  location_state: string | null;
  location_city: string | null;
  location_address: string | null;
  title: string | null;
  caption: string | null;
  keywords: unknown;
  rating: number | null;
  copyright: string | null;
  creator: string | null;
  source: string;
  version: number;
  created_at: string;
  updated_at: string;
}

const selectMetadata = (photoId: string, tx: Db | Tx) =>
  row<MetadataRow>(
    sql`SELECT ${METADATA_COLUMNS}, ${drfTs("date_taken")} AS date_taken, ${drfTs("date_modified")} AS date_modified,
      ${drfTs("created_at")} AS created_at, ${drfTs("updated_at")} AS updated_at
      FROM api_photometadata WHERE photo_id = ${photoId}::uuid`,
    tx,
  );

/** PhotoMetadata.objects.get_or_create(photo=..., defaults from the photo). */
async function getOrCreate(photoId: string, tx: Db | Tx): Promise<MetadataRow> {
  const existing = await selectMetadata(photoId, tx);
  if (existing) return existing;
  await rows(
    sql`INSERT INTO api_photometadata (id, photo_id, date_taken, gps_latitude, gps_longitude, rating, source, version, created_at, updated_at)
      SELECT gen_random_uuid(), p.id, p.exif_timestamp, p.exif_gps_lat, p.exif_gps_lon, p.rating, 'embedded', 1, now(), now()
      FROM api_photo p WHERE p.id = ${photoId}::uuid ON CONFLICT (photo_id) DO NOTHING`,
    tx,
  );
  return (await selectMetadata(photoId, tx))!;
}

async function render(photo: MetadataPhoto) {
  const m = await getOrCreate(photo.id, db);
  const [edits, sidecars] = await Promise.all([
    rows<{
      id: string;
      field_name: string;
      old_value: unknown;
      new_value: unknown;
      user_id: number;
      user_name: string | null;
      synced_to_file: boolean;
      synced_at: string | null;
      created_at: string;
    }>(sql`SELECT e.id, e.field_name, e.old_value, e.new_value, e.user_id, u.username AS user_name,
        e.synced_to_file, ${drfTs("e.synced_at")} AS synced_at, ${drfTs("e.created_at")} AS created_at
      FROM api_metadataedit e LEFT JOIN api_user u ON u.id = e.user_id
      WHERE e.photo_id = ${photo.id}::uuid ORDER BY e.created_at DESC, e.id DESC LIMIT 10`),
    rows<{
      id: string;
      file_type: string;
      source: string;
      priority: number;
      creator_software: string | null;
      created_at: string;
      updated_at: string;
    }>(sql`SELECT id, file_type, source, priority, creator_software, ${drfTs("created_at")} AS created_at,
        ${drfTs("updated_at")} AS updated_at
      FROM api_metadatafile WHERE photo_id = ${photo.id}::uuid ORDER BY priority DESC, updated_at DESC, id`),
  ]);
  return {
    id: m.id,
    aperture: m.aperture,
    shutter_speed: m.shutter_speed,
    shutter_speed_seconds: m.shutter_speed_seconds,
    iso: m.iso,
    focal_length: m.focal_length,
    focal_length_35mm: m.focal_length_35mm,
    exposure_compensation: m.exposure_compensation,
    flash_fired: m.flash_fired,
    metering_mode: m.metering_mode,
    white_balance: m.white_balance,
    camera_make: m.camera_make,
    camera_model: m.camera_model,
    lens_make: m.lens_make,
    lens_model: m.lens_model,
    serial_number: m.serial_number,
    camera_display: displayName(m.camera_make, m.camera_model),
    lens_display: displayName(m.lens_make, m.lens_model),
    width: m.width,
    height: m.height,
    orientation: m.orientation,
    color_space: m.color_space,
    bit_depth: m.bit_depth,
    resolution: resolution(m.width, m.height),
    megapixels: megapixels(m.width, m.height),
    date_taken: m.date_taken,
    date_taken_subsec: m.date_taken_subsec,
    date_modified: m.date_modified,
    timezone_offset: m.timezone_offset,
    gps_latitude: m.gps_latitude,
    gps_longitude: m.gps_longitude,
    gps_altitude: m.gps_altitude,
    location_country: m.location_country,
    location_state: m.location_state,
    location_city: m.location_city,
    location_address: m.location_address,
    has_location: m.gps_latitude !== null && m.gps_longitude !== null,
    title: m.title,
    caption: m.caption,
    keywords: m.keywords ?? null,
    rating: m.rating,
    copyright: m.copyright,
    creator: m.creator,
    source: m.source,
    version: m.version,
    created_at: m.created_at,
    updated_at: m.updated_at,
    edit_history: edits.map((e) => ({
      id: e.id,
      field_name: e.field_name,
      old_value: e.old_value ?? null,
      new_value: e.new_value ?? null,
      user: e.user_id,
      user_name: e.user_name ?? "Unknown",
      synced_to_file: e.synced_to_file,
      synced_at: e.synced_at,
      created_at: e.created_at,
    })),
    sidecar_files: sidecars,
  };
}

export async function getMetadata(user: User, id: string) {
  return render(await findPhoto(user, id));
}

type Kind = { t: "text"; max: number | null } | { t: "int" } | { t: "float" } | { t: "json" } | { t: "time" };

/** PhotoMetadataUpdateSerializer.Meta.fields, in order. */
const EDITABLE: [keyof MetadataRow & string, Kind][] = [
  ["title", { t: "text", max: 500 }],
  ["caption", { t: "text", max: null }],
  ["keywords", { t: "json" }],
  ["rating", { t: "int" }],
  ["copyright", { t: "text", max: null }],
  ["creator", { t: "text", max: 200 }],
  ["gps_latitude", { t: "float" }],
  ["gps_longitude", { t: "float" }],
  ["location_country", { t: "text", max: 100 }],
  ["location_state", { t: "text", max: 100 }],
  ["location_city", { t: "text", max: 100 }],
  ["location_address", { t: "text", max: null }],
  ["date_taken", { t: "time" }],
  ["timezone_offset", { t: "text", max: 10 }],
];

/** A validated value; time values are microseconds since the epoch. */
type MetaValue = string | number | unknown | null;

/** Python's int()/float() take `_` between two digits; drop those, refuse any other `_`. */
function pyDigits(s: string): string | null {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "_" && !(i > 0 && /\d/.test(s[i - 1]) && /\d/.test(s[i + 1] ?? ""))) return null;
  }
  return s.replaceAll("_", "");
}

const FLOAT_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** Microseconds since the epoch of an ISO string with offset (microseconds kept). */
function isoMicros(iso: string): number {
  const m = /^(.*?)(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(iso)!;
  const frac = (m[2] ?? "").padEnd(6, "0");
  return Date.parse(m[1] + m[3]) * 1000 + Number(frac);
}

/** DRF format of microseconds since the epoch. */
function microsDrf(us: number): string {
  const secs = Math.floor(us / 1e6);
  const frac = us - secs * 1e6;
  const base = new Date(secs * 1000).toISOString().slice(0, 19);
  return frac ? `${base}.${String(frac).padStart(6, "0")}Z` : `${base}Z`;
}

function validate(kind: Kind, v: unknown): { ok: MetaValue } | { err: string } {
  if (v === null) return { ok: null };
  switch (kind.t) {
    case "text": {
      let s: string;
      if (typeof v === "string") s = v.trim();
      else if (typeof v === "number") s = String(v);
      else return { err: "Not a valid string." };
      if (kind.max !== null && [...s].length > kind.max) return { err: `Ensure this field has no more than ${kind.max} characters.` };
      return { ok: s };
    }
    case "int": {
      const INVALID = "A valid integer is required.";
      let n: number;
      if (typeof v === "number") {
        if (!Number.isInteger(v)) return { err: INVALID };
        n = v;
      } else if (typeof v === "string") {
        let t = v.trim();
        const dot = t.indexOf(".");
        if (dot >= 0 && /^0*$/.test(t.slice(dot + 1))) t = t.slice(0, dot);
        const d = pyDigits(t.trim());
        if (d === null || !/^[+-]?\d+$/.test(d)) return { err: INVALID };
        n = Number(d);
      } else return { err: INVALID };
      if (n > 2147483647) return { err: "Ensure this value is less than or equal to 2147483647." };
      if (n < -2147483648) return { err: "Ensure this value is greater than or equal to -2147483648." };
      return { ok: n };
    }
    case "float": {
      let f: number | null = null;
      if (typeof v === "number") f = v;
      else if (typeof v === "boolean") f = v ? 1 : 0;
      else if (typeof v === "string") {
        const d = pyDigits(v.trim());
        if (d !== null && FLOAT_RE.test(d)) f = Number(d);
      }
      return f !== null && Number.isFinite(f) ? { ok: f } : { err: "A valid number is required." };
    }
    case "json":
      return { ok: v };
    case "time": {
      const parsed =
        typeof v === "string" && (v.includes("T") || v.trim().includes(" ")) ? parseClientDatetime(v) : null;
      return parsed !== null
        ? { ok: isoMicros(parsed) }
        : { err: "Datetime has wrong format. Use one of these formats instead: YYYY-MM-DDThh:mm[:ss[.uuuuuu]][+HH:MM|-HH:MM|Z]." };
    }
  }
}

/** JSON with sorted object keys (serde_json's default map), for equality. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object") {
    return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical((v as Record<string, unknown>)[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}

/** The stored value of a field, typed like a validated one. */
function current(m: MetadataRow, field: string, kind: Kind): MetaValue {
  const v = (m as unknown as Record<string, unknown>)[field] ?? null;
  if (kind.t === "time") return v === null ? null : isoMicros((v as string).replace(/Z$/, "+00:00"));
  return v;
}

const differs = (kind: Kind, a: MetaValue, b: MetaValue) =>
  kind.t === "json" ? (a === null) !== (b === null) || (a !== null && canonical(a) !== canonical(b)) : a !== b;

/** How MetadataEdit.old_value/new_value store a value (SQL NULL for None). */
function editJson(kind: Kind, v: MetaValue): SQL {
  if (v === null) return sql`NULL`;
  if (kind.t === "time") return jsonbParam(microsDrf(v as number));
  // serde_json writes an integral f64 as "52.0".
  if (kind.t === "float" && Number.isInteger(v) && Math.abs(v as number) < 1e16) return sql`${`${v}.0`}::text::jsonb`;
  return jsonbParam(v);
}

function columnValue(kind: Kind, v: MetaValue): SQL {
  if (v === null) return sql`NULL`;
  switch (kind.t) {
    case "json":
      return jsonbParam(v);
    case "time":
      return sql`${microsDrf(v as number)}::timestamptz`;
    case "int":
      return sql`${v}::int`;
    case "float":
      return sql`${v}::double precision`;
    default:
      return sql`${v}::text`;
  }
}

/** tag_names: trimmed, non-empty, deduplicated, clipped to 512 chars, sorted. */
function tagNames(keywords: unknown): string[] {
  let items: string[] = [];
  if (Array.isArray(keywords)) items = keywords.filter((k): k is string => typeof k === "string");
  else if (typeof keywords === "string") items = [...keywords];
  else if (keywords && typeof keywords === "object") items = Object.keys(keywords);
  const out = new Set<string>();
  for (const k of items) {
    const t = k.trim();
    if (t) out.add([...t].slice(0, 512).join(""));
  }
  return [...out].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

async function syncTags(tx: Tx, photo: MetadataPhoto, keywords: unknown, previous: unknown) {
  const names = tagNames(keywords);
  const keep = new Set(names);
  const dropped = tagNames(previous).filter((n) => !keep.has(n));
  const touched: number[] = [];
  if (dropped.length) {
    const removed = await rows<{ tag_id: number }>(
      sql`DELETE FROM api_tag_photos WHERE photo_id = ${photo.id}::uuid AND tag_id IN
        (SELECT t.id FROM api_tag t WHERE t.owner_id = ${photo.owner_id} AND t.name = ANY(${pgArray(dropped, "text")})) RETURNING tag_id`,
      tx,
    );
    touched.push(...removed.map((r) => r.tag_id));
  }
  for (const name of names) {
    let tag = await row<{ id: number }>(sql`SELECT id FROM api_tag WHERE name = ${name} AND owner_id = ${photo.owner_id}`, tx);
    tag ??= await row<{ id: number }>(
      sql`INSERT INTO api_tag (name, owner_id, photo_count, last_modified) VALUES (${name}, ${photo.owner_id}, 0, now()) RETURNING id`,
      tx,
    );
    await rows(
      sql`INSERT INTO api_tag_photos (tag_id, photo_id) SELECT ${tag!.id}, ${photo.id}::uuid
        WHERE NOT EXISTS (SELECT 1 FROM api_tag_photos WHERE tag_id = ${tag!.id} AND photo_id = ${photo.id}::uuid)`,
      tx,
    );
    touched.push(tag!.id);
  }
  // Each tag.photos.remove/add also bumps the tag's last_modified (mobile-sync m2m_changed).
  if (touched.length) {
    await rows(
      sql`UPDATE api_tag SET photo_count = (SELECT count(*) FROM api_tag_photos tp JOIN api_photo p ON p.id = tp.photo_id
          WHERE tp.tag_id = api_tag.id AND NOT p.hidden AND NOT p.in_trashcan AND NOT p.removed), last_modified = now()
        WHERE api_tag.id = ANY(${pgArray(touched, "int")})`,
      tx,
    );
  }
}

function pyTypeName(v: unknown): string {
  if (Array.isArray(v)) return "list";
  if (typeof v === "string") return "str";
  if (typeof v === "boolean") return "bool";
  if (typeof v === "number") return Number.isInteger(v) ? "int" : "float";
  return "NoneType";
}

export async function patchMetadata(user: User, id: string, request: Request) {
  const photo = await findPhoto(user, id);
  const body = await jsonBody<unknown>(request);
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw ApiError.validation(`Invalid data. Expected a dictionary, but got ${pyTypeName(body)}.`);
  }
  const b = body as Record<string, unknown>;
  const changes: [string, Kind, MetaValue][] = [];
  const errors: FieldError[] = [];
  for (const [field, kind] of EDITABLE) {
    if (!(field in b)) continue;
    const r = validate(kind, b[field]);
    if ("err" in r) errors.push({ field, message: r.err });
    else changes.push([field, kind, r.ok]);
  }
  if (errors.length) throw ApiError.fields(400, errors);

  await db.transaction(async (tx) => {
    const m = await getOrCreate(photo.id, tx);
    let nEdits = 0;
    for (const [field, kind, value] of changes) {
      const old = current(m, field, kind);
      if (!differs(kind, old, value)) continue;
      await rows(
        sql`INSERT INTO api_metadataedit (id, field_name, old_value, new_value, synced_to_file, synced_at, created_at, photo_id, user_id)
          VALUES (gen_random_uuid(), ${field}, ${editJson(kind, old)}, ${editJson(kind, value)}, FALSE, NULL,
            now() + ${nEdits} * interval '1 microsecond', ${photo.id}::uuid, ${user.id})`,
        tx,
      );
      nEdits++;
    }
    const sets = changes.map(([field, kind, value]) => sql`${sql.raw(field)} = ${columnValue(kind, value)}`);
    sets.push(sql`source = 'user_edit', version = version + 1, updated_at = now() + ${nEdits} * interval '1 microsecond'`);
    await rows(sql`UPDATE api_photometadata SET ${sql.join(sets, sql`, `)} WHERE id = ${m.id}::uuid`, tx);
    const kw = changes.find(([f]) => f === "keywords");
    if (kw) await syncTags(tx, photo, kw[2], m.keywords ?? null);
  });
  return render(photo);
}
