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

/**
 * `POST /upload/` chunk response (chunked_upload/views.py get_response_data): the upload to send
 * the next chunk to, and the bytes it holds so far.
 */
export const UploadResponse = z.object({
  upload_id: z.string(),
  offset: z.number(),
});
export type UploadResponse = z.infer<typeof UploadResponse>;

/**
 * `POST /upload/complete/`: `{}` (ChunkedUploadCompleteView.get_response_data), whether the photo
 * was imported or the user already had the file. Loose, so a body a newer server adds still parses.
 */
export const UploadCompleteResponse = z.looseObject({});
export type UploadCompleteResponse = z.infer<typeof UploadCompleteResponse>;

/** `GET /exists/{md5}{user id}/`: whether the user already has a photo with this hash. */
export const UploadExistsResponse = z.object({
  exists: z.boolean(),
});
export type UploadExistsResponse = z.infer<typeof UploadExistsResponse>;
