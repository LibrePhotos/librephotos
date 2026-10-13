import { z } from "zod";

/** One optional ML feature's switch in the site settings (#2217). */
const SiteFeatureState = z.object({
  // Whether the feature runs: the server environment allows it and the site switch is on.
  enabled: z.boolean(),
  // The FEATURE_* environment variable turned it off; the site switch cannot turn it back on.
  locked: z.boolean(),
  // Whether the model it runs on is on disk; null for a feature that needs no model.
  model_ready: z.boolean().nullable(),
});

/** The feature switches, by feature. Staff only. */
export const SiteFeatures = z.object({
  video: SiteFeatureState,
  face_detection: SiteFeatureState,
  face_cluster: SiteFeatureState,
  image_captioning: SiteFeatureState,
  reverse_geocoding: SiteFeatureState,
  scene_classification: SiteFeatureState,
});
export type SiteFeatures = z.infer<typeof SiteFeatures>;
export type SiteFeatureName = keyof SiteFeatures;

/** The newest Download Models job. Staff only. */
export const SiteModelDownload = z.object({
  id: z.number(),
  // "running", "finished", "failed" or "cancelled". A string, so a state a newer server adds
  // does not fail the whole settings answer (the login page reads it).
  status: z.string(),
  progress_current: z.number(),
  progress_target: z.number(),
});
export type SiteModelDownload = z.infer<typeof SiteModelDownload>;

/** GET/POST /api/sitesettings (api/views/site_settings.py). GET is anonymous; POST is admin-only. */
export const SiteSettings = z.object({
  allow_registration: z.boolean(),
  allow_upload: z.boolean(),
  skip_patterns: z.string(),
  map_api_key: z.string(),
  map_api_provider: z.string(),
  map_tile_provider: z.string(),
  captioning_model: z.string(),
  // Gone with the LLM; the server still sends "None" for older clients.
  llm_model: z.string().optional(),
  // The captions_json key the tags live under: the one tagging model's name.
  tagging_model: z.string(),
  // Older backends do not know about OCR yet. Default it instead of requiring it, so a client
  // running against such a backend still renders the rest of the settings.
  ocr_model: z.string().default("none"),
  face_recognition_model: z.string(),
  nextcloud_enabled: z.boolean().default(false),
  // Older backends do not have the setting; they never create user folders.
  auto_create_user_directory: z.boolean().default(false),
  // Largest share of a user's photos a scan may mark missing (0 to 1, #2195); older backends lack it.
  scan_missing_max_fraction: z.number().optional(),
  // Days a photo stays in the trash before the daily cleanup deletes it and its files; 0 = never
  // (#2203). Sent to every user for the trash page; older backends lack it.
  trash_retention_days: z.number().optional(),
  email_configured: z.boolean().optional(),
  // Always 0: the setting is gone; older clients still read the key.
  heavyweight_process: z.number().optional(),
  // Staff only, and older backends have no feature switches.
  features: SiteFeatures.optional(),
  model_download: SiteModelDownload.nullish(),
});
export type SiteSettings = z.infer<typeof SiteSettings>;

/**
 * POST /api/sitesettings body: only the settings to change. A feature switch is posted flat as
 * `<feature>_enabled`; one the server environment locked is refused with a 400 naming the field.
 */
export type SiteSettingsUpdate = Partial<
  Omit<SiteSettings, "features" | "model_download" | "heavyweight_process"> & {
    [K in SiteFeatureName as `${K}_enabled`]: boolean;
  }
>;

/** GET /api/timezones/: every time zone name the date-time rules accept. */
export const Timezones = z.string().array();
export type Timezones = z.infer<typeof Timezones>;

// One entry of the backend's PROVIDER_PRESETS (api/models/email_config.py).
// Amazon SES has no fixed host, and only SendGrid a default user name.
const EmailProviderPreset = z.object({
  label: z.string(),
  host: z.string().optional(),
  port: z.number(),
  use_tls: z.boolean(),
  use_ssl: z.boolean(),
  default_username: z.string().optional(),
  help_url: z.string(),
});

/** GET/POST /api/email-config/ (admin): the instance email setup. The stored secret is never sent. */
export const EmailConfig = z.object({
  provider: z.string(),
  from_email: z.string(),
  host: z.string(),
  port: z.number(),
  use_tls: z.boolean(),
  use_ssl: z.boolean(),
  username: z.string(),
  has_secret: z.boolean(),
  is_configured: z.boolean(),
  presets: z.record(z.string(), EmailProviderPreset),
});
export type EmailConfig = z.infer<typeof EmailConfig>;

/**
 * POST /api/email-config/ body: only the fields to change. `secret` replaces the stored
 * credential when not blank, `clear_secret` wipes it.
 */
export type EmailConfigUpdate = Partial<{
  provider: string;
  from_email: string;
  host: string;
  port: number;
  use_tls: boolean;
  use_ssl: boolean;
  username: string;
  secret: string;
  clear_secret: boolean;
}>;

/** POST /api/email-config/test/: a sent test email. A failed send is an ApiError (502, code email_send_failed). */
export const EmailTestResponse = z.object({
  status: z.literal(true),
  message: z.string(),
});
export type EmailTestResponse = z.infer<typeof EmailTestResponse>;
