import { z } from 'zod'

export const UploadResponse = z.object({
  upload_id: z.string(),
  offset: z.number(),
})

export const UploadExistResponse = z.object({
  exists: z.boolean(),
})

export const UploadOptions = z.object({
  form_data: z.instanceof(FormData),
  offset: z.number(),
  chunk_size: z.number(),
})

export type IUploadOptions = z.infer<typeof UploadOptions>
export type IUploadResponse = z.infer<typeof UploadResponse>
