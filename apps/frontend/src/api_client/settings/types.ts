import { z } from "zod";

export const SiteSettings = z.object({
  allow_registration: z.boolean(),
  allow_upload: z.boolean(),
  skip_patterns: z.string(),
  map_api_key: z.string(),
  map_api_provider: z.string(),
  map_tile_provider: z.string(),
  captioning_model: z.string(),
  llm_model: z.string(),
  tagging_model: z.string(),
  // Older backends do not know about OCR yet. Default it instead of requiring it, so that a
  // frontend running against such a backend still renders the rest of the settings page.
  ocr_model: z.string().default("none"),
  face_recognition_model: z.string(),
  nextcloud_enabled: z.boolean().default(false),
  email_configured: z.boolean().optional(),
});

export type SiteSettings = z.infer<typeof SiteSettings>;

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
  presets: z.record(z.string(), z.record(z.string(), z.any())),
});

export type EmailConfig = z.infer<typeof EmailConfig>;

export type PredefinedRules = string[];

export const Timezones = z.string().array();
export type Timezones = z.infer<typeof Timezones>;
