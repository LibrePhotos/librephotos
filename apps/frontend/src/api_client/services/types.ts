import { z } from "zod";

// GET /api/services/
export const ServicesListResponse = z.object({
  services: z.record(z.string(), z.number()),
});
export type ServicesListResponse = z.infer<typeof ServicesListResponse>;

// GET /api/services/{service_name}/
export const ServiceHealthResponse = z.object({
  service_name: z.string(),
  healthy: z.boolean(),
});
export type ServiceHealthResponse = z.infer<typeof ServiceHealthResponse>;

// POST /api/services/{service_name}/start/ and /stop/
export const ServiceActionResponse = z.object({
  message: z.string(),
});
export type ServiceActionResponse = z.infer<typeof ServiceActionResponse>;
