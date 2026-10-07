// GET/POST /api/sitesettings (api/views/site_settings.py), validated like
// api/schemas/site_settings.py. Port of lp_api::users_settings::site_settings
// and lp_db::write::settings::save.
import { ApiError } from "~/lib/errors";
import { db, jsonbParam, sql } from "~/lib/db";
import { jsonBody } from "~/lib/http";
import { applySetting, constanceEncode, invalidateSettings, SETTING_DEFAULTS, siteSettings, type SiteSettings } from "~/lib/settings";
import type { User } from "~/lib/users";
import { emailIsConfigured } from "./email";
import { reembedMismatched } from "./ml_triggers";

/** (request key, constance key, JSON type) in the schema's order. */
const FIELDS: [string, string, "boolean" | "string"][] = [
  ["allow_registration", "ALLOW_REGISTRATION", "boolean"],
  ["allow_upload", "ALLOW_UPLOAD", "boolean"],
  ["skip_patterns", "SKIP_PATTERNS", "string"],
  ["map_api_provider", "MAP_API_PROVIDER", "string"],
  ["map_api_key", "MAP_API_KEY", "string"],
  ["map_tile_provider", "MAP_TILE_PROVIDER", "string"],
  ["captioning_model", "CAPTIONING_MODEL", "string"],
  ["tagging_model", "TAGGING_MODEL", "string"],
  ["ocr_model", "OCR_MODEL", "string"],
  ["face_recognition_model", "FACE_RECOGNITION_MODEL", "string"],
  ["semantic_search_model", "SEMANTIC_SEARCH_MODEL", "string"],
  ["nextcloud_enabled", "NEXTCLOUD_ENABLED", "boolean"],
  ["auto_create_user_directory", "AUTO_CREATE_USER_DIRECTORY", "boolean"],
];

function body(s: SiteSettings, isStaff: boolean, emailConfigured: boolean) {
  return {
    allow_registration: s.ALLOW_REGISTRATION,
    allow_upload: s.ALLOW_UPLOAD,
    skip_patterns: s.SKIP_PATTERNS,
    heavyweight_process: 0,
    map_api_provider: s.MAP_API_PROVIDER,
    // The GET is anonymous (the login page reads it); the key is the admin's credential.
    map_api_key: isStaff ? s.MAP_API_KEY : "",
    map_tile_provider: s.MAP_TILE_PROVIDER,
    captioning_model: s.CAPTIONING_MODEL,
    llm_model: "None",
    tagging_model: s.TAGGING_MODEL,
    ocr_model: s.OCR_MODEL,
    face_recognition_model: s.FACE_RECOGNITION_MODEL,
    semantic_search_model: s.SEMANTIC_SEARCH_MODEL,
    nextcloud_enabled: s.NEXTCLOUD_ENABLED,
    auto_create_user_directory: s.AUTO_CREATE_USER_DIRECTORY,
    email_configured: emailConfigured,
  };
}

export async function getSiteSettings(viewer: User | null) {
  const [s, configured] = await Promise.all([siteSettings(), emailIsConfigured()]);
  return body(s, viewer?.isStaff ?? false, configured);
}

/** jsonschema.validate(request.data, site_settings_schema); Django lets it escape as a 500, this is a 400. */
function validate(data: unknown): [string, unknown][] {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw ApiError.validation(`${JSON.stringify(data)} is not of type 'object'`);
  }
  const obj = data as Record<string, unknown>;
  const changes: [string, unknown][] = [];
  for (const [key, constance, ty] of FIELDS) {
    if (!(key in obj)) continue;
    const v = obj[key];
    if (typeof v !== ty) throw ApiError.badRequest(key, `${JSON.stringify(v)} is not of type '${ty}'`);
    changes.push([constance, v]);
  }
  if (!changes.length) throw ApiError.validation(`${JSON.stringify(data)} is not valid under any of the given schemas`);
  return changes;
}

/** Store the changes, mirrored into constance_constance when it exists so Django sees them too. */
async function save(changes: [string, unknown][]) {
  const probe = SETTING_DEFAULTS();
  for (const [k, v] of changes) if (!applySetting(probe, k, v)) throw ApiError.internal(`invalid site setting ${k}`);
  await db.transaction(async (tx) => {
    const r = (await tx.execute(sql`SELECT to_regclass('public.constance_constance') IS NOT NULL AS c`)) as unknown as { c: boolean }[];
    for (const [k, v] of changes) {
      await tx.execute(sql`INSERT INTO site_settings (key, value, updated_at) VALUES (${k}, ${jsonbParam(v)}, now())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`);
      if (r[0]?.c) {
        await tx.execute(sql`INSERT INTO constance_constance (key, value) VALUES (${k}, ${constanceEncode(v)})
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
      }
    }
  });
  invalidateSettings();
}

export async function postSiteSettings(admin: User, req: Request) {
  const changes = validate(await jsonBody<unknown>(req));
  const model = changes.find(([k]) => k === "SEMANTIC_SEARCH_MODEL");
  if (model && !["clip_vit_b32", "mobileclip_s2"].includes(model[1] as string)) {
    throw ApiError.badRequest("semantic_search_model", `${JSON.stringify(model[1])} is not one of ['clip_vit_b32', 'mobileclip_s2']`);
  }
  await save(changes);
  // Embeddings of two models must never share an index.
  await reembedMismatched();
  return getSiteSettings(admin);
}
