import { z } from "zod";

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
  email_configured: z.boolean().optional(),
});
export type SiteSettings = z.infer<typeof SiteSettings>;

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
