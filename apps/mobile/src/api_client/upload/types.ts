import { z } from 'zod'

export const UploadOptions = z.object({
  form_data: z.instanceof(FormData),
  offset: z.number(),
  chunk_size: z.number(),
})

export type UploadOptions = z.infer<typeof UploadOptions>
