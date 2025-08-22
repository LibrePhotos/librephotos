import { z } from "zod";

export const PublicPhotoSample = z.object({
  image_hash: z.string(),
  rating: z.number(),
  hidden: z.boolean(),
  exif_timestamp: z.string().nullable(),
  public: z.boolean(),
  video: z.boolean(),
});
export type PublicPhotoSample = z.infer<typeof PublicPhotoSample>;

export const User = z.object({
  id: z.number(),
  username: z.string(),
  email: z.string(),
  scan_directory: z.string().optional(),
  confidence: z.number(),
  confidence_person: z.number(),
  transcode_videos: z.boolean(),
  semantic_search_topk: z.number(),
  first_name: z.string(),
  public_photo_samples: z.array(PublicPhotoSample),
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
  face_recognition_model: z.string(),
  confidence_unknown_face: z.number(),
  min_cluster_size: z.number(),
  min_samples: z.number(),
  cluster_selection_epsilon: z.number(),
  llm_settings: z.any().nullable(),
  text_alignment: z.enum(['left', 'right']).default('right'),
  header_size: z.enum(['large', 'normal', 'small']).default('large'),
}); 

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
});

export const SimpleUser = z.object({
  id: z.number(),
  username: z.string(),
  first_name: z.string(),
  last_name: z.string(),
});

export type User = z.infer<typeof User>;
export type ManageUser = z.infer<typeof ManageUser>;


export const UserList = User.array();
export type UserList = z.infer<typeof UserList>;

export type UserState = {
  userSelfDetails: User;
  error: Error | string | null | undefined;
};
