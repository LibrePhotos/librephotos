import { z } from "zod";

export const SiteSettings = z.object({
  allow_registration: z.boolean(),
  allow_upload: z.boolean(),
  skip_patterns: z.string(),
  map_api_key: z.string(),
  map_api_provider: z.string(),
  captioning_model: z.string(),
  llm_model: z.string(),
});

export type SiteSettings = z.infer<typeof SiteSettings>;

export type PredefinedRules = string[];

export const Timezones = z.string().array();
export type Timezones = z.infer<typeof Timezones>;
