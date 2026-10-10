import { z } from "zod";
import { DateTimeRule } from "../../components/settings/date-time.zod";

export const SiteSettings = z.object({
  allow_registration: z.boolean(),
  allow_upload: z.boolean(),
  skip_patterns: z.string(),
  map_api_key: z.string(),
  map_api_provider: z.string(),
  map_tile_provider: z.string(),
  captioning_model: z.string(),
  // Gone with the LLM; older servers still send it.
  llm_model: z.string().optional(),
  // The captions_json key the tags live under: the one tagging model's name.
  tagging_model: z.string(),
  // Older backends do not know about OCR yet. Default it instead of requiring it, so that a
  // frontend running against such a backend still renders the rest of the settings page.
  ocr_model: z.string().default("none"),
  face_recognition_model: z.string(),
  nextcloud_enabled: z.boolean().default(false),
  // Older backends do not have the setting; they never create user folders.
  auto_create_user_directory: z.boolean().default(false),
  email_configured: z.boolean().optional(),
});

export type SiteSettings = z.infer<typeof SiteSettings>;

// One entry of the backend's PROVIDER_PRESETS (api/models/email_config.py).
// Amazon SES has no fixed host, and only SendGrid a default user name.
export const EmailProviderPreset = z.object({
  label: z.string(),
  host: z.string().optional(),
  port: z.number(),
  use_tls: z.boolean(),
  use_ssl: z.boolean(),
  default_username: z.string().optional(),
  help_url: z.string(),
});
export type EmailProviderPreset = z.infer<typeof EmailProviderPreset>;

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

// The backend's PREDEFINED_RULES_JSON: date-time rule objects (see
// components/settings/date-time.zod.ts), sent as a JSON string.
export const PredefinedRules = z.array(DateTimeRule);
export type PredefinedRules = z.infer<typeof PredefinedRules>;

export const Timezones = z.string().array();
export type Timezones = z.infer<typeof Timezones>;
