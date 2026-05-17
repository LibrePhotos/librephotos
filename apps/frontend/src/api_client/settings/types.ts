import { z } from "zod";

export const GeocodeThrottleProfile = z.object({
  enabled: z.boolean(),
  requests_per_second: z.number(),
  burst_size: z.number().int(),
});
export type GeocodeThrottleProfile = z.infer<typeof GeocodeThrottleProfile>;

export const SiteSettings = z.object({
  allow_registration: z.boolean(),
  allow_upload: z.boolean(),
  skip_patterns: z.string(),
  map_api_key: z.string(),
  map_api_provider: z.string(),
  geocode_throttle_profiles: z.record(GeocodeThrottleProfile),
  geocode_active_throttle_profile: GeocodeThrottleProfile.optional(),
  captioning_model: z.string(),
  llm_model: z.string(),
  tagging_model: z.string(),
  face_recognition_model: z.string(),
});

export type SiteSettings = z.infer<typeof SiteSettings>;

export type PredefinedRules = string[];

export const Timezones = z.string().array();
export type Timezones = z.infer<typeof Timezones>;
