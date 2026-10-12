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
