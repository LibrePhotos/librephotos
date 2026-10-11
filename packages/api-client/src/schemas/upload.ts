import { z } from "zod";

/**
 * Chunked upload request. `form_data` is a FormData carrying the chunk bytes;
 * the transport passes FormData through untouched (no JSON encoding).
 */
export const UploadOptions = z.object({
  form_data: z.instanceof(FormData),
  offset: z.number(),
  chunk_size: z.number(),
});
export type UploadOptions = z.infer<typeof UploadOptions>;

/** POST /api/upload/ chunk response. */
export const UploadResponse = z.object({
  upload_id: z.string().optional(),
  offset: z.number().optional(),
});
export type UploadResponse = z.infer<typeof UploadResponse>;
