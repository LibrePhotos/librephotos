import { z } from "zod";

// GET /api/services/
export const ServicesListResponse = z.object({
  services: z.record(z.string(), z.number()),
});
export type ServicesListResponse = z.infer<typeof ServicesListResponse>;

// GET /api/services/{service_name}/
// enabled/feature_flag are optional so that a backend predating them reads as an
// ordinary always-on service rather than failing the parse, which the health
// query would then report as unhealthy.
export const ServiceHealthResponse = z.object({
  service_name: z.string(),
  healthy: z.boolean(),
  enabled: z.boolean().optional(),
  feature_flag: z.string().nullable().optional(),
});
export type ServiceHealthResponse = z.infer<typeof ServiceHealthResponse>;

// POST /api/services/{service_name}/start/ and /stop/
export const ServiceActionResponse = z.object({
  message: z.string(),
});
export type ServiceActionResponse = z.infer<typeof ServiceActionResponse>;
