import { z } from 'zod'

export const GeocodeResultSchema = z.object({
  display_name: z.string(),
  lat: z.number(),
  lon: z.number(),
})

export type GeocodeResult = z.infer<typeof GeocodeResultSchema>

export const GeocodeSearchResponseSchema = z.array(GeocodeResultSchema)

export type GeocodeSearchResponse = z.infer<typeof GeocodeSearchResponseSchema>
