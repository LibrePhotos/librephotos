// The geocoder (api/geocode): `geo.locate` (processing_jobs.add_geolocation +
// geocode/photo_location.py), reverseGeocode for the GPS edit and
// searchLocation for /api/geocode/search, over the providers Django
// configures through geopy, spoken directly (port of lp_tasks::geocode).
import { client } from "../../lib/db";
import { config } from "../../lib/config";
import { JobType } from "../../lib/jobs";
import { siteSettings } from "../../lib/settings";
import { getTags } from "./exif";
import { PHOTO_CONCURRENCY, forEachPhoto } from "./photos";
import { lastFinishedStart, sinceParams, startItems } from "./run";
import type { Exec } from "./things";

/** GEOCODE_VERSION: stored as `_v` in geolocation_json. */
export const GEOCODE_VERSION = "1";
const TIMEOUT_MS = 10_000;

type Provider = "nominatim" | "mapbox" | "maptiler" | "tomtom" | "opencage";
const PROVIDERS: Provider[] = ["nominatim", "mapbox", "maptiler", "tomtom", "opencage"];
const DEFAULT_BASE: Record<Provider, string> = {
  nominatim: "https://nominatim.openstreetmap.org",
  mapbox: "https://api.mapbox.com",
  maptiler: "https://api.maptiler.com",
  tomtom: "https://api.tomtom.com",
  opencage: "https://api.opencagedata.com",
};

const baseOverrides = new Map<Provider, string>();
/** Point a provider at another origin (tests, a self-hosted Nominatim). LP_GEOCODE_<PROVIDER>_URL does the same. */
export function setGeocodeBase(provider: Provider, base: string) {
  baseOverrides.set(provider, base.replace(/\/+$/, ""));
}
function baseUrl(p: Provider): string {
  const o = baseOverrides.get(p);
  if (o) return o;
  const env = process.env[`LP_GEOCODE_${p.toUpperCase()}_URL`]?.trim().replace(/\/+$/, "");
  return env || DEFAULT_BASE[p];
}

// ---------------------------------------------------------- rate limit

/** Minimum seconds between two calls to a provider (geocode/rate_limit.py). */
const minDelayMs = (p: string) => (p === "nominatim" ? 1100 : 50);
const lastCall = new Map<string, number>();
/** rate_limit.wait: block until the provider's window is open, then claim it. */
export async function waitForProvider(p: string): Promise<void> {
  for (;;) {
    const now = performance.now();
    const t = lastCall.get(p);
    const delay = minDelayMs(p);
    if (t === undefined || now - t >= delay) {
      lastCall.set(p, now);
      return;
    }
    await new Promise((r) => setTimeout(r, delay - (now - t)));
  }
}

// ------------------------------------------------------------ providers

/** geopy's "%(lat)s,%(lon)s": Python float repr. */
function coord(v: number): string {
  if (Number.isInteger(v) && Math.abs(v) < 1e16) return `${v}.0`;
  return String(v);
}

/** urllib.parse.quote with safe="/". */
const pyQuote = (s: string) =>
  [...new TextEncoder().encode(s)].map((b) => (/[A-Za-z0-9_.\-~/]/.test(String.fromCharCode(b)) && b < 128 ? String.fromCharCode(b) : "%" + b.toString(16).toUpperCase().padStart(2, "0"))).join("");

async function getJson(url: string, query: [string, string][]): Promise<any> {
  const u = new URL(url);
  for (const [k, v] of query) u.searchParams.append(k, v);
  const res = await fetch(u, { headers: { "User-Agent": "librephotos" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

const text = (v: unknown): string | null => (v === null || v === undefined ? null : typeof v === "string" ? v : JSON.stringify(v));
function num(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.trim());
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

function placeResult(places: string[], address: string | null, center: [number, number]) {
  return {
    features: places.map((p) => ({ text: p, center })),
    places,
    address,
    center,
    _v: GEOCODE_VERSION,
  };
}

/** The provider's parser (api/geocode/parsers/*) over one raw result. */
function parse(p: Provider, raw: any): object | null {
  switch (p) {
    case "nominatim": {
      const data = raw?.address;
      if (!data || typeof data !== "object") return null;
      const props = ["road", "town", "neighbourhood", "suburb", "hamlet", "borough", "city", "county", "state", "country"];
      const places = props.map((k) => text(data[k])).filter((x): x is string => x !== null);
      const lat = num(raw.lat);
      const lon = num(raw.lon);
      if (lat === null || lon === null) return null;
      return placeResult(places, text(raw.display_name), [lat, lon]);
    }
    case "mapbox":
    case "maptiler": {
      const c = raw?.center;
      if (!Array.isArray(c)) return null;
      const lat = num(c[1]);
      const lon = num(c[0]);
      const first = text(raw.text);
      if (lat === null || lon === null || first === null || !Array.isArray(raw.context)) return null;
      const places = [first];
      for (const item of raw.context) {
        const id = typeof item?.id === "string" ? item.id : "";
        const t = text(item?.text);
        if (!id.startsWith("post") && t !== null) places.push(t);
      }
      return placeResult(places, text(raw.place_name), [lat, lon]);
    }
    case "tomtom": {
      const data = raw?.address;
      if (!data || typeof raw.position !== "string") return null;
      const parts = raw.position.split(",").map((x: string) => Number(x.trim()));
      if (parts.length < 2 || parts.slice(0, 2).some(Number.isNaN)) return null;
      const props = ["street", "streetName", "municipalitySubdivision", "countrySubdivision", "countrySecondarySubdivision", "municipality", "municipalitySubdivision", "country"];
      const places: string[] = [];
      for (const k of props) {
        const v = text(data[k]);
        if (v !== null && [...v].length > 2 && !places.includes(v)) places.push(v);
      }
      return placeResult(places, text(data.freeformAddress), [parts[0], parts[1]]);
    }
    case "opencage": {
      const data = raw?.components;
      const g = raw?.geometry;
      if (!data || !g) return null;
      const lat = num(g.lat);
      const lng = num(g.lng);
      if (lat === null || lng === null) return null;
      const props = [typeof data._type === "string" ? data._type : "", "road", "suburb", "municipality", "hamlet", "towncity", "borough", "state", "county", "country"];
      const places = props.map((k) => text(data[k])).filter((x): x is string => x !== null);
      return placeResult(places, text(raw.formatted), [lat, lng]);
    }
  }
}

async function reverseRaw(p: Provider, apiKey: string, lat: number, lon: number): Promise<object> {
  if (p !== "nominatim" && !apiKey) {
    console.warn("No API key found for map provider. Please set MAP_API_KEY in the admin panel or switch map provider.");
  }
  const base = baseUrl(p);
  let raw: any = null;
  if (p === "nominatim") {
    const v = await getJson(`${base}/reverse`, [
      ["lat", coord(lat)],
      ["lon", coord(lon)],
      ["format", "json"],
      ["addressdetails", "1"],
    ]);
    raw = v && typeof v === "object" && "error" in v ? null : v;
  } else if (p === "mapbox" || p === "maptiler") {
    const point = pyQuote(`${coord(lon)},${coord(lat)}`);
    const v =
      p === "mapbox"
        ? await getJson(`${base}/geocoding/v5/mapbox.places/${point}.json/`, [["access_token", apiKey]])
        : await getJson(`${base}/geocoding/${point}.json`, [["key", apiKey]]);
    raw = Array.isArray(v?.features) ? (v.features[0] ?? null) : null;
  } else if (p === "tomtom") {
    const v = await getJson(`${base}/search/2/reverseGeocode/${pyQuote(`${coord(lat)},${coord(lon)}`)}.json`, [["key", apiKey]]);
    raw = Array.isArray(v?.addresses) ? (v.addresses[0] ?? null) : null;
  } else {
    const v = await getJson(`${base}/geocode/v1/json`, [
      ["key", apiKey],
      ["q", `${coord(lat)},${coord(lon)}`],
    ]);
    raw = Array.isArray(v?.results) ? (v.results[0] ?? null) : null;
  }
  if (raw === null || raw === undefined) return {};
  const parsed = parse(p, raw);
  if (!parsed) throw new Error(`unexpected ${p} reply`);
  return parsed;
}

/** reverse_geocode: {} when the feature is off, the provider unknown or the call failed (logged). */
export async function reverseGeocode(lat: number, lon: number): Promise<Record<string, unknown>> {
  if (!config.features.reverseGeocoding) return {};
  const s = await siteSettings();
  const name = s.MAP_API_PROVIDER;
  await waitForProvider(name);
  if (!PROVIDERS.includes(name as Provider)) {
    console.warn(`Error while reverse geocoding: Map provider not found: ${name}.`);
    return {};
  }
  try {
    return (await reverseRaw(name as Provider, s.MAP_API_KEY, lat, lon)) as Record<string, unknown>;
  } catch (e) {
    console.warn(`Error while reverse geocoding: ${(e as Error).message}`);
    return {};
  }
}

export interface Place {
  display_name: string | null;
  lat: number;
  lon: number;
}

/** search_location for GET /api/geocode/search?q=: empty on any provider error (logged), like Django. */
export async function searchLocation(query: string, limit: number): Promise<Place[]> {
  const s = await siteSettings();
  const name = s.MAP_API_PROVIDER;
  await waitForProvider(name);
  if (!PROVIDERS.includes(name as Provider)) {
    console.warn(`Error while searching location: Map provider not found: ${name}.`);
    return [];
  }
  try {
    return await search(name as Provider, s.MAP_API_KEY, query, limit);
  } catch (e) {
    console.warn(`Error while searching location: ${(e as Error).message}`);
    return [];
  }
}

async function search(p: Provider, apiKey: string, query: string, limit: number): Promise<Place[]> {
  const place = (name: string | null, lat: number | null, lon: number | null): Place => {
    if (lat === null) throw new Error("result without latitude");
    if (lon === null) throw new Error("result without longitude");
    return { display_name: name, lat, lon };
  };
  const base = baseUrl(p);
  if (p === "nominatim") {
    if (limit < 1) throw new Error("Limit cannot be less than 1");
    const v = await getJson(`${base}/search`, [
      ["q", query],
      ["format", "json"],
      ["limit", String(limit)],
    ]);
    const items = Array.isArray(v) ? v : v && typeof v === "object" && Object.keys(v).length && !("error" in v) ? [v] : [];
    return items.map((r: any) => place(typeof r?.display_name === "string" ? r.display_name : null, num(r?.lat), num(r?.lon)));
  }
  if (p === "tomtom") {
    const params: [string, string][] = [
      ["key", apiKey],
      ["typeahead", "false"],
    ];
    if (limit !== 0) params.push(["limit", String(limit)]);
    const v = await getJson(`${base}/search/2/geocode/${pyQuote(query)}.json`, params);
    return (Array.isArray(v?.results) ? v.results : []).map((r: any) => {
      const name = r?.address?.freeformAddress;
      if (typeof name !== "string") throw new Error("result without freeformAddress");
      return place(name, num(r?.position?.lat), num(r?.position?.lon));
    });
  }
  throw new Error("geocode() got an unexpected keyword argument 'limit'");
}

// --------------------------------------------------------------- the job

export async function locate(userId: number, fullScan: boolean, jobId: string): Promise<void> {
  const [useSince, since] = sinceParams(fullScan ? undefined : await lastFinishedStart(userId, JobType.AddGeolocation, false));
  const ids: { id: string }[] = await client`SELECT p.id::text AS id FROM api_photo p WHERE p.owner_id = ${userId}
    AND (${useSince}::boolean IS FALSE OR p.added_on > ${since}::timestamptz) ORDER BY p.id`;
  if (!(await startItems(jobId, ids.length))) return;
  await forEachPhoto(
    jobId,
    ids.map((r) => r.id),
    PHOTO_CONCURRENCY,
    (id) => geolocatePhoto(id),
  );
}

interface GeoPhoto {
  image_hash: string;
  owner_id: number;
  exif_gps_lat: number | null;
  exif_gps_lon: number | null;
  /** exif_timestamp's UTC date (YYYY-MM-DD), Django's .date() under TIME_ZONE=UTC. */
  exif_date: string | null;
  geolocation_json: any;
  main_path: string | null;
}

async function loadGeoPhoto(photoId: string): Promise<GeoPhoto | undefined> {
  const [r] = await client`SELECT p.image_hash, p.owner_id, p.exif_gps_lat, p.exif_gps_lon,
      to_char(p.exif_timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS exif_date, p.geolocation_json, f.path AS main_path
    FROM api_photo p LEFT JOIN api_file f ON f.hash = p.main_file_id WHERE p.id = ${photoId}`;
  return r;
}

/** _has_usable_coordinates: both present and not the (0, 0) null island. */
export const usableCoordinates = (lat: number | null, lon: number | null) => lat !== null && lon !== null && !(lat === 0 && lon === 0);

/**
 * geolocation_job for one photo: geolocate_photo, then
 * add_location_to_album_dates from the stored geolocation, which also runs
 * when the photo was up to date or the geocoder gave nothing.
 */
export async function geolocatePhoto(photoId: string): Promise<void> {
  const photo = await loadGeoPhoto(photoId);
  if (!photo) return;
  await geolocate(photoId, photo);
  const after = await loadGeoPhoto(photoId);
  if (!after || after.geolocation_json === null || after.geolocation_json === undefined) return;
  await client.begin(async (tx) => addLocationToAlbumDate(tx as unknown as Exec, after, after.geolocation_json));
}

async function geolocate(photoId: string, photo: GeoPhoto): Promise<void> {
  const fail = (msg: string) => new Error(`Photo ${photo.image_hash}: ${msg}`);
  if (!photo.main_path) throw fail("'NoneType' object has no attribute 'path'");
  let values: unknown[];
  try {
    values = (await getTags(photo.main_path, ["Composite:GPSLatitude", "Composite:GPSLongitude"], false)) ?? [];
  } catch (e) {
    throw fail((e as Error).message);
  }
  const lat = num(values[0]);
  const lon = num(values[1]);
  if (!usableCoordinates(lat, lon)) return;
  const [{ in_places }] = await client`SELECT EXISTS (SELECT 1 FROM api_albumplace_photos WHERE photo_id = ${photoId}) AS in_places`;
  const current = photo.geolocation_json?._v === GEOCODE_VERSION;
  if (photo.exif_gps_lat === lat && photo.exif_gps_lon === lon && in_places && current) return;
  // The coordinates are saved before the geocoder runs, so a geocoder
  // failure still leaves them stored.
  await client`UPDATE api_photo SET exif_gps_lat = ${lat}, exif_gps_lon = ${lon}, last_modified = now() WHERE id = ${photoId}`;
  const res = await reverseGeocode(lat!, lon!);
  if (!res || typeof res !== "object" || !Object.keys(res).length) return;
  await client.begin(async (txn) => {
    const tx = txn as unknown as Exec;
    await tx`UPDATE api_photo SET geolocation_json = ${JSON.stringify(res)}::text::jsonb, last_modified = now() WHERE id = ${photoId}`;
    await updateSearchLocation(tx, photoId, res);
    await moveToAlbumPlaces(tx, photoId, photo.image_hash, photo.owner_id, res);
  });
}

/** PhotoSearch.update_search_location on a get_or_create'd row. */
export async function updateSearchLocation(tx: Exec, photoId: string, res: Record<string, any>): Promise<void> {
  let location: string | null;
  if ("address" in res) location = typeof res.address === "string" ? res.address : null;
  else if (Array.isArray(res.features)) location = res.features.map((f: any) => f?.text).filter((t: unknown) => typeof t === "string" && t).join(", ");
  else location = "";
  await tx`INSERT INTO api_photo_search (photo_id, search_captions, search_location, created_at, updated_at)
    VALUES (${photoId}, NULL, ${location}, now(), now())
    ON CONFLICT (photo_id) DO UPDATE SET search_location = EXCLUDED.search_location, updated_at = now()`;
}

/** Python str.isnumeric(). */
const isNumeric = (s: string) => s !== "" && /^\p{N}+$/u.test(s);

/**
 * _move_to_album_places: out of every Places album, then into one per named
 * feature (geolocation_level = distance from the end, set when the album
 * does not hold the photo's hash yet).
 */
export async function moveToAlbumPlaces(tx: Exec, photoId: string, imageHash: string, ownerId: number, res: Record<string, any>): Promise<void> {
  const old: { id: number }[] = await tx`DELETE FROM api_albumplace_photos WHERE photo_id = ${photoId} RETURNING albumplace_id AS id`;
  if (old.length) {
    await tx`UPDATE api_albumplace SET last_modified = now() WHERE id = ANY(${"{" + old.map((o) => o.id).join(",") + "}"}::int[])`;
  }
  const features: any[] = Array.isArray(res.features) ? res.features : [];
  const n = features.length;
  for (let level = 0; level < n; level++) {
    const f = features[level];
    if (!f || typeof f !== "object" || !("text" in f)) continue;
    const title = typeof f.text === "string" ? f.text : JSON.stringify(f.text);
    if (isNumeric(title)) continue;
    await tx`INSERT INTO api_albumplace (title, geolocation_level, favorited, owner_id, last_modified)
      VALUES (${title}, NULL, FALSE, ${ownerId}, now()) ON CONFLICT (title, owner_id) DO NOTHING`;
    const [{ id, has_hash }] = await tx`SELECT a.id, EXISTS (SELECT 1 FROM api_albumplace_photos l JOIN api_photo p ON p.id = l.photo_id
        WHERE l.albumplace_id = a.id AND p.image_hash = ${imageHash}) AS has_hash
      FROM api_albumplace a WHERE a.title = ${title} AND a.owner_id = ${ownerId} FOR UPDATE`;
    await tx`UPDATE api_albumplace SET last_modified = now(),
        geolocation_level = CASE WHEN ${has_hash}::boolean THEN geolocation_level ELSE ${n - level}::int END WHERE id = ${id}`;
    await tx`INSERT INTO api_albumplace_photos (albumplace_id, photo_id) VALUES (${id}, ${photoId}) ON CONFLICT DO NOTHING`;
  }
}

function jsonEq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** add_location_to_album_dates: the city (second-to-last place) joins the location of the day album holding the photo. */
async function addLocationToAlbumDate(tx: Exec, photo: GeoPhoto, res: any): Promise<void> {
  const places: unknown[] = Array.isArray(res?.places) ? res.places : [];
  if (places.length < 2) return;
  const city = places[places.length - 2];
  const albums: { id: number; location: any }[] = await tx`SELECT a.id, a.location FROM api_albumdate a
    WHERE a.owner_id = ${photo.owner_id} AND a.date IS NOT DISTINCT FROM ${photo.exif_date}::date LIMIT 2 FOR UPDATE`;
  if (albums.length !== 1) return;
  const [{ id, location }] = albums;
  const [{ holds }] = await tx`SELECT EXISTS (SELECT 1 FROM api_albumdate_photos l JOIN api_photo p ON p.id = l.photo_id
    WHERE l.albumdate_id = ${id} AND p.image_hash = ${photo.image_hash}) AS holds`;
  if (!holds) return;
  let next: Record<string, unknown>;
  if (location && typeof location === "object" && !Array.isArray(location) && Object.keys(location).length) {
    next = { ...location };
    const list: unknown[] = Array.isArray(location.places) ? [...location.places] : [];
    if (!list.some((v) => jsonEq(v, city))) {
      list.push(city);
      const unique: unknown[] = [];
      for (const v of list) if (!unique.some((u) => jsonEq(u, v))) unique.push(v);
      next.places = unique;
    }
  } else {
    next = { places: [city] };
  }
  await tx`UPDATE api_albumdate SET location = ${JSON.stringify(next)}::text::jsonb WHERE id = ${id}`;
}
