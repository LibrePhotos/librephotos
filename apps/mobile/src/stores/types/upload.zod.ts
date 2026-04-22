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

export const UploadStateSchema = z.object({
  current: z.number(),
  total: z.number(),
  isUploading: z.boolean(),
})

export type IUploadOptions = z.infer<typeof UploadOptions>
export type IUploadResponse = z.infer<typeof UploadResponse>
export type UploadState = z.infer<typeof UploadStateSchema>
