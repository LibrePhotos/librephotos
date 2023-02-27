import type { FetchBaseQueryError } from '@reduxjs/toolkit/query'
import { z } from 'zod'

export const PublicPhotoSampleSchema = z.object({
  image_hash: z.string(),
  rating: z.number(),
  hidden: z.boolean(),
  exif_timestamp: z.string(),
  public: z.boolean(),
  video: z.boolean(),
})
export type IPublicPhotoSample = z.infer<typeof PublicPhotoSampleSchema>

export const UserSchema = z.object({
  id: z.number(),
  username: z.string(),
  email: z.string(),
  scan_directory: z.string().optional(),
  confidence: z.number(),
  confidence_person: z.number(),
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
  password: z.string().optional(),
  is_superuser: z.boolean().optional(),
  public_sharing: z.boolean(),
})

export const ManageUser = z.object({
  confidence: z.number(),
  date_joined: z.string(),
  favorite_min_rating: z.number(),
  id: z.number(),
  image_scale: z.number(),
  last_login: z.string().nullable(),
  photo_count: z.number(),
  save_metadata_to_disk: z.string(),
  scan_directory: z.string().nullish(),
  semantic_search_topk: z.number(),
  username: z.string().optional(),
  email: z.string().nullable(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  password: z.string().optional(),
  public_sharing: z.boolean(),
})

export const SimpleUser = z.object({
  id: z.number(),
  username: z.string(),
  first_name: z.string(),
  last_name: z.string(),
})

export type IUser = z.infer<typeof UserSchema>
export type IManageUser = z.infer<typeof ManageUser>

export const ApiUserListResponseSchema = z.object({
  count: z.number(),
  next: z.string().nullable(),
  previous: z.string().nullable(),
  results: z.array(UserSchema),
})

export type IApiUserListResponse = z.infer<typeof ApiUserListResponseSchema>

export type IUserState = {
  userSelfDetails: IUser
  error: Error | FetchBaseQueryError | string | null | undefined
}
