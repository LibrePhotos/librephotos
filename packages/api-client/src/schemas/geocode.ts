import { z } from "zod";

/** `GET /geocode/search?q=` (api/views/geocode.py): places matching a name, for the location picker. */
export const GeocodeResult = z.object({
  display_name: z.string(),
  lat: z.number(),
  lon: z.number(),
});
export type GeocodeResult = z.infer<typeof GeocodeResult>;

export const GeocodeSearchResponse = z.array(GeocodeResult);
export type GeocodeSearchResponse = z.infer<typeof GeocodeSearchResponse>;

/**
 * `GET /geocode/reverse/?lat=&lon=` (api/views/geocode.py): the place name at a spot, as a photo
 * moved there would get it. `place` is null when the provider has no name for it, and
 * `enabled` false when reverse geocoding is turned off on the server.
 */
export const GeocodeReverseResponse = z.object({
  enabled: z.boolean(),
  place: z.string().nullable(),
});
export type GeocodeReverseResponse = z.infer<typeof GeocodeReverseResponse>;
