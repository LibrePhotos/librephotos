import { z } from "zod";

// Copied from the frontend hook files that parse these responses (they import
// React Query, so the harness cannot import them directly).

/** apps/frontend/src/api_client/upload/hooks/useUploadExistsMutation.ts */
export const UploadExistResponse = z.object({
  exists: z.boolean(),
});

/** apps/frontend/src/api_client/upload/hooks/useUploadMutation.ts */
export const UploadResponse = z.object({
  upload_id: z.string(),
  offset: z.number(),
});

/** Plain-Django error body of the chunked upload views (the UI shows `detail`). */
export const UploadError = z.object({
  detail: z.string(),
});
