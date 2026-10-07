// Site settings (formerly constance; port of lp_core::settings). Stored as
// site_settings(key, value jsonb) with the constance key names; a key without
// a row takes the env-derived default. Shared with librephotos-rs.
import { config } from "./config";
import { db, sql } from "./db";

export const SETTING_DEFAULTS = () => ({
  ALLOW_REGISTRATION: false as boolean,
  ALLOW_UPLOAD: config.allowUpload as boolean,
  NEXTCLOUD_ENABLED: config.nextcloudEnabled as boolean,
  AUTO_CREATE_USER_DIRECTORY: false as boolean,
  SKIP_PATTERNS: config.skipPatterns as string,
  MAP_API_PROVIDER: config.mapApiProvider as string,
  MAP_API_KEY: config.mapboxApiKey as string,
  MAP_TILE_PROVIDER: config.mapTileProvider as string,
  IMAGE_DIRS: "/data" as string,
  CAPTIONING_MODEL: "lfm2_vl_450m" as string,
  TAGGING_MODEL: "mobileclip_s2" as string,
  OCR_MODEL: "None" as string,
  FACE_RECOGNITION_MODEL: "buffalo_sc" as string,
  SEMANTIC_SEARCH_MODEL: "mobileclip_s2" as string,
  LOG_MAX_BYTES: 200 * 1024 * 1024,
  LOG_BACKUP_COUNT: 10,
  OIDC_ENABLED: false as boolean,
  OIDC_BUTTON_LABEL: "Sign in with SSO" as string,
  OIDC_ALLOW_SIGNUP: false as boolean,
});

export type SiteSettings = ReturnType<typeof SETTING_DEFAULTS>;
export type SettingKey = keyof SiteSettings;
/** The constance keys, in CONSTANCE_CONFIG order. */
export const SETTING_KEYS = Object.keys(SETTING_DEFAULTS()) as SettingKey[];

/** Apply one stored value; unknown keys and wrong types are ignored (false). */
export function applySetting(s: SiteSettings, key: string, value: unknown): boolean {
  if (!(key in s)) return false;
  const cur = (s as Record<string, unknown>)[key];
  if (typeof cur === "number" ? !Number.isInteger(value) : typeof value !== typeof cur) return false;
  (s as Record<string, unknown>)[key] = value;
  return true;
}

let cached: { at: number; value: SiteSettings } | null = null;
const TTL_MS = 2000;

/** Env-derived defaults overlaid with every stored row (cached briefly; other processes may write). */
export async function siteSettings(): Promise<SiteSettings> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  const s = SETTING_DEFAULTS();
  const rs = (await db.execute(sql`SELECT key, value FROM site_settings`)) as unknown as { key: string; value: unknown }[];
  for (const r of rs) {
    const v = typeof r.value === "string" && !(typeof (s as any)[r.key] === "string") ? safeParse(r.value) : r.value;
    applySetting(s, r.key, v);
  }
  cached = { at: Date.now(), value: s };
  return s;
}

function safeParse(v: string) {
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

export function invalidateSettings() {
  cached = null;
}

/** django-constance 4.x codec: {"__type__": "default", "__value__": v}. undefined = undecodable. */
export function constanceDecode(raw: string): unknown {
  let v: any;
  try {
    v = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (v && typeof v === "object" && !Array.isArray(v) && "__type__" in v && "__value__" in v) {
    if (Object.keys(v).length !== 2 || v.__type__ !== "default") return undefined;
    return v.__value__;
  }
  return v;
}

/** json.dumps(v) with Python's default separators and ensure_ascii=True. */
export function pyJsonDumps(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : pyFloat(v);
  if (typeof v === "string") return pyStr(v);
  if (Array.isArray(v)) return "[" + v.map(pyJsonDumps).join(", ") + "]";
  return "{" + Object.entries(v as object).map(([k, x]) => `${pyStr(k)}: ${pyJsonDumps(x)}`).join(", ") + "}";
}

function pyFloat(f: number): string {
  if (!Number.isFinite(f)) return Number.isNaN(f) ? "NaN" : f > 0 ? "Infinity" : "-Infinity";
  return String(f);
}

function pyStr(s: string): string {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (ch === "\b") out += "\\b";
    else if (ch === "\f") out += "\\f";
    else if (c < 0x20 || c > 0x7e) {
      for (let i = 0; i < ch.length; i++) out += "\\u" + ch.charCodeAt(i).toString(16).padStart(4, "0");
    } else out += ch;
  }
  return out + '"';
}

export const constanceEncode = (v: unknown) => `{"__type__": "default", "__value__": ${pyJsonDumps(v)}}`;
