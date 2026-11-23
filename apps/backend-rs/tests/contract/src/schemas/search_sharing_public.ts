// Frontend schemas of the search/sharing/public area that live in hook files
// (which import React / TanStack), copied verbatim. Keep in sync with the
// named source files.
import { PigPhoto, SimpleUser } from "@librephotos/api-client";
import { z } from "zod";

// apps/frontend/src/api_client/photos/hooks/useFetchSharedPhotosByMeQuery.ts
export const SharedPhotosByMeResponse = z.object({
  results: z
    .object({
      user_id: z.number(),
      user: SimpleUser,
      photo: PigPhoto,
    })
    .array(),
});

// apps/frontend/src/api_client/photos/hooks/useFetchSharedPhotosWithMeQuery.ts
export const SharedPhotosWithMeResponse = z.object({
  results: PigPhoto.array(),
});

// apps/frontend/src/api_client/photos/hooks/useFetchPublicPhotoDetailQuery.ts
export const PublicPhotoDetail = z.object({
  image_hash: z.string(),
  video: z.boolean(),
  square_thumbnail_url: z.string(),
  big_thumbnail_url: z.string(),
  small_square_thumbnail_url: z.string(),
  exif_timestamp: z.string().nullable().optional(),
  exif_gps_lat: z.number().nullable().optional(),
  exif_gps_lon: z.number().nullable().optional(),
  geolocation_json: z.record(z.unknown()).nullable().optional(),
  search_location: z.string().optional(),
  camera: z.string().nullable().optional(),
  lens: z.string().nullable().optional(),
  focal_length: z.number().nullable().optional(),
  fstop: z.number().nullable().optional(),
  iso: z.number().nullable().optional(),
  shutter_speed: z.string().nullable().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  search_captions: z.string().optional(),
  captions_json: z.record(z.unknown()).optional(),
  people: z
    .array(
      z.object({
        name: z.string(),
        face_url: z.string().nullable(),
        face_id: z.number(),
      }),
    )
    .optional(),
});

export const PublicPhotoDetailResponse = z.object({
  results: PublicPhotoDetail,
  sharing_settings: z.object({
    share_location: z.boolean(),
    share_camera_info: z.boolean(),
    share_timestamps: z.boolean(),
    share_captions: z.boolean(),
    share_faces: z.boolean(),
  }),
});

// apps/frontend/src/api_client/photos/hooks/usePhotoShareMutation.ts
export const SharedPhoto = z.object({
  video: z.boolean(),
  thumbnail_url: z.string(),
  video_url: z.string().nullable(),
  exif_timestamp: z.string().nullable().optional(),
  search_location: z.string().optional(),
  camera: z.string().nullable().optional(),
  lens: z.string().nullable().optional(),
  search_captions: z.string().optional(),
  captions_json: z.record(z.unknown()).optional(),
  people: z.array(z.object({ name: z.string() })).optional(),
});

export const SharedPhotoResponse = z.object({ results: SharedPhoto });
