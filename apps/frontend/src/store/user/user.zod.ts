import { z } from "zod";
import type { FetchBaseQueryError } from "@reduxjs/toolkit/query";

export const PublicPhotoSampleSchema = z.object({
  image_hash: z.string(),
  rating: z.number(),
  hidden: z.boolean(),
  exif_timestamp: z.string(),
  public: z.boolean(),
  video: z.boolean(),
});
export type IPublicPhotoSample = z.infer<typeof PublicPhotoSampleSchema>;

export const UserSchema = z.object({
  id: z.number(),
  username: z.string(),
  email: z.string(),
  scan_directory: z.string().optional(),
  confidence: z.number(),
  transcode_videos: z.boolean(),
  semantic_search_topk: z.number(),
  first_name: z.string(),
  public_photo_samples: z.array(PublicPhotoSampleSchema),
  last_name: z.string(),
  public_photo_count: z.number(),
  date_joined: z.string(),
  avatar: z.any().nullable(),
  photo_count: z.number(),
  nextcloud_server_address: z.any().nullable(),
  nextcloud_username: z.any().nullable(),
  nextcloud_scan_directory: z.any().nullable(),
  avatar_url: z.any().nullable(),
  favorite_min_rating: z.number(),
  image_scale: z.number(),
  save_metadata_to_disk: z.string(),
  datetime_rules: z.string(),
  default_timezone: z.string(),
});

export type IUser = z.infer<typeof UserSchema>;

export type IUserState = {
  userSelfDetails: IUser;
  error: Error | FetchBaseQueryError | string | null | undefined;
};
