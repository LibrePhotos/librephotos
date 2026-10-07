// GET /api/geocode/search?q=[&limit=] (api/views/geocode.py): a bare array of
// {display_name, lat, lon}, empty on any provider error. Port of
// lp_api::search_sharing_public::geocode and the search half of
// lp_tasks::geocode (rate limit + providers::search).
import { ApiError } from "~/lib/errors";
import type { QueryMap } from "~/lib/query";
import { siteSettings } from "~/lib/settings";

interface Place {
  display_name: string | null;
  lat: number;
  lon: number;
}

const PY_SPACE = /^[\s\x1c-\x1f\x85]+|[\s\x1c-\x1f\x85]+$/g;

/** Python int(str): surrounding whitespace, a sign, `_` between digits. */
function pyIntStrict(s: string): number | null {
  const t = s.replace(PY_SPACE, "");
  if (!/^[+-]?\d+(_\d+)*$/.test(t)) return null;
  return Number(t.replaceAll("_", ""));
}

const DEFAULT_BASES: Record<string, string> = {
  nominatim: "https://nominatim.openstreetmap.org",
  mapbox: "https://api.mapbox.com",
  maptiler: "https://api.maptiler.com",
  tomtom: "https://api.tomtom.com",
  opencage: "https://api.opencagedata.com",
};

function baseUrl(provider: string): string {
  const v = process.env[`LP_GEOCODE_${provider.toUpperCase()}_URL`]?.trim().replace(/\/+$/, "");
  return v || DEFAULT_BASES[provider];
}

/** Minimum gap between two provider calls (rate_limit.py; Nominatim asks for 1/s). */
const lastCall = new Map<string, number>();
async function waitForProvider(provider: string) {
  const delay = provider === "nominatim" ? 1100 : 50;
  for (;;) {
    const now = Date.now();
    const last = lastCall.get(provider);
    if (last === undefined || now - last >= delay) {
      lastCall.set(provider, now);
      return;
    }
    await Bun.sleep(delay - (now - last));
  }
}

function num(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v.trim()))) return Number(v.trim());
  return null;
}

async function getJson(url: string, params: Record<string, string>): Promise<unknown> {
  const res = await fetch(`${url}?${new URLSearchParams(params)}`, {
    headers: { "User-Agent": "librephotos" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

const pyQuote = (s: string) =>
  Array.from(new TextEncoder().encode(s), (b) =>
    /[A-Za-z0-9_.\-~/]/.test(String.fromCharCode(b)) ? String.fromCharCode(b) : "%" + b.toString(16).toUpperCase().padStart(2, "0"),
  ).join("");

function place(name: string | null, lat: number | null, lon: number | null): Place {
  if (lat === null || lon === null) throw new Error("result without coordinates");
  return { display_name: name, lat, lon };
}

async function providerSearch(provider: string, apiKey: string, query: string, limit: number): Promise<Place[]> {
  const base = baseUrl(provider);
  switch (provider) {
    case "nominatim": {
      if (limit < 1) throw new Error("Limit cannot be less than 1");
      const v = await getJson(`${base}/search`, { q: query, format: "json", limit: String(limit) });
      let items: unknown[] = [];
      if (Array.isArray(v)) items = v;
      else if (v && typeof v === "object" && Object.keys(v).length && !("error" in v)) items = [v];
      return items.map((r) => {
        const o = (r ?? {}) as Record<string, unknown>;
        return place(typeof o.display_name === "string" ? o.display_name : null, num(o.lat), num(o.lon));
      });
    }
    case "tomtom": {
      const params: Record<string, string> = { key: apiKey, typeahead: "false" };
      if (limit !== 0) params.limit = String(limit);
      const v = (await getJson(`${base}/search/2/geocode/${pyQuote(query)}.json`, params)) as Record<string, unknown>;
      const results = Array.isArray(v?.results) ? (v.results as Record<string, any>[]) : [];
      return results.map((r) => {
        const name = r?.address?.freeformAddress;
        if (typeof name !== "string") throw new Error("result without freeformAddress");
        return place(name, num(r?.position?.lat), num(r?.position?.lon));
      });
    }
    case "mapbox":
    case "maptiler":
    case "opencage":
      throw new Error("geocode() got an unexpected keyword argument 'limit'");
    default:
      throw new Error(`Map provider not found: ${provider}.`);
  }
}

export async function geocodeSearch(q: QueryMap): Promise<Place[]> {
  const query = (q.get("q") ?? "").replace(PY_SPACE, "");
  if (!query) return [];
  const raw = q.get("limit");
  let limit = 5;
  if (raw !== undefined) {
    const n = pyIntStrict(raw);
    if (n === null) throw ApiError.internal(`invalid literal for int() with base 10: '${raw}'`);
    limit = n;
  }
  const settings = await siteSettings();
  const provider = settings.MAP_API_PROVIDER;
  await waitForProvider(provider);
  try {
    return await providerSearch(provider, settings.MAP_API_KEY, query, limit);
  } catch (e) {
    console.warn(`Error while searching location: ${(e as Error).message}`);
    return [];
  }
}
