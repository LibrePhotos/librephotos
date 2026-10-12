import { z } from "zod";

const GeocodeResultSchema = z.object({
  display_name: z.string(),
  lat: z.number(),
  lon: z.number(),
});

export const GeocodeSearchResponseSchema = z.array(GeocodeResultSchema);

export type GeocodeSearchResponse = z.infer<typeof GeocodeSearchResponseSchema>;
