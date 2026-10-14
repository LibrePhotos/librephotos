// Schemas the frontend defines inside hook files (which import React), copied
// verbatim, plus schemas for the responses it only types with TS interfaces.
import { z } from "zod";

// apps/frontend/src/api_client/jobs/hooks/useScanPhotosMutation.ts,
// useRescanPhotosMutation.ts and useGenerateOcrMutation.ts (identical copies).
export const JobResponse = z.object({
  status: z.boolean(),
  job_id: z.string(),
});

// apps/frontend/src/api_client/photos/hooks/useDeleteMissingPhotosMutation.ts
export const DeleteMissingPhotosResponse = z.object({
  status: z.boolean(),
  job_id: z.string().optional(),
});

// useDownloadPhotosMutation.ts types these with TS only:
// `type DownloadResponse = { url: string; job_id: string }` and
// `type StatusResponse = { status: string }` (it switches on SUCCESS / FAILURE).
export const DownloadResponse = z.object({
  url: z.string().uuid(),
  job_id: z.string(),
});
export const DownloadStatusResponse = z.object({
  status: z.enum(["SUCCESS", "FAILURE", "PENDING"]),
});
