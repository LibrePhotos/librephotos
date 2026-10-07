// Response schemas of the photo_edits endpoints. The frontend defines them
// inside hook files (which import React), so they are copied here verbatim;
// each names its source under apps/frontend/src/api_client/photos/hooks/.
import { z } from "zod";

// useSetFavoritePhotosMutation.ts (UpdatedPhotosResponse), useSetPhotosHiddenMutation.ts and
// useSetPhotosPublicMutation.ts (UpdatePhotosResponse): identical shapes.
export const UpdatedPhotosResponse = z.object({
  status: z.boolean(),
  updated_hashes: z.string().array().optional(),
  not_updated_hashes: z.string().array().optional(),
  count: z.number().optional(),
});

// useMarkPhotosDeletedMutation.ts
export const DeletePhotosResponse = z.object({
  status: z.boolean(),
  updated_hashes: z.string().array().optional(),
  not_updated_hashes: z.string().array().optional(),
  count: z.number().optional(),
});

// usePurgeDeletedPhotosMutation.ts
export const PurgePhotosResponse = z.object({
  status: z.boolean(),
  results: z.string().array().optional(),
  deleted: z.string().array().optional(),
  not_deleted: z.string().array().optional(),
  count: z.number().optional(),
});

// useUpdatePhotoSharingMutation.ts
export const SharePhotosResponse = z.object({
  status: z.boolean(),
  count: z.number(),
});

// useUpdatePhotoMutation.ts
export const PhotoUpdateResponse = z.object({
  image_hash: z.string(),
  hidden: z.boolean(),
  rating: z.number(),
  in_trashcan: z.boolean(),
  removed: z.boolean(),
  video: z.boolean(),
  exif_timestamp: z.string().nullable(),
  timestamp: z.string().nullable(),
});

// useSavePhotoCaptionMutation.ts
export const SaveCaptionResponse = z.object({
  status: z.boolean(),
});

// useGenerateImageToTextCaptionMutation.ts
export const GenerateCaptionResponse = z.object({
  status: z.boolean(),
  reason: z.string().optional(),
  message: z.string().optional(),
});

// useRotatePhotosMutation.ts
export const RotatePhotosResponse = z.discriminatedUnion("status", [
  z.object({
    status: z.literal(true),
    image_hash: z.string(),
    local_orientation: z.number(),
    last_modified: z.string(),
  }),
  z.object({
    status: z.literal(false),
    message: z.string().optional(),
  }),
]);

// usePhotoShareMutation.ts
export const PhotoShare = z.object({
  enabled: z.boolean(),
  slug: z.string().nullable(),
  url: z.string().nullable(),
  created_at: z.string().optional(),
  photo_id: z.string().optional(),
  image_hash: z.string().optional(),
});
export const PhotoShareResponse = z.object({ status: z.boolean(), share: PhotoShare });
export const PhotoShareListResponse = z.object({ results: PhotoShare.array() });
