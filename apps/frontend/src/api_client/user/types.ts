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

export const PublicSharingDefaults = z.object({
  share_location: z.boolean().default(false),
  share_camera_info: z.boolean().default(false),
  share_timestamps: z.boolean().default(false),
  share_captions: z.boolean().default(false),
  share_faces: z.boolean().default(false),
});
export type PublicSharingDefaults = z.infer<typeof PublicSharingDefaults>;

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
  nextcloud_app_password: z.string().optional(),
  nextcloud_scan_directory: z.any().nullable(),
  avatar_url: z.any().nullable(),
  favorite_min_rating: z.number(),
  image_scale: z.number(),
  save_metadata_to_disk: z.string(),
  save_face_tags_to_disk: z.boolean().default(false),
  scrub_face_region_tags_on_delete: z.boolean().default(false),
  datetime_rules: z.string(),
  burst_detection_rules: z.any().optional(), // JSON array of burst detection rules
  default_timezone: z.string(),
  // Skip RAW files during scans (deprecated, kept for backward compatibility)
  skip_raw_files: z.boolean().optional().default(false),
  // Stack RAW+JPEG pairs automatically during scans and as default for manual detection
  stack_raw_jpeg: z.boolean().optional().default(true),
  password: z.string().optional(),
  is_superuser: z.boolean().optional(),
  public_sharing: z.boolean(),
  confidence_unknown_face: z.number(),
  min_cluster_size: z.number(),
  min_samples: z.number(),
  cluster_selection_epsilon: z.number(),
  llm_settings: z.any().nullable(),
  public_sharing_defaults: PublicSharingDefaults.optional(),
  text_alignment: z.enum(["left", "right"]).default("right"),
  header_size: z.enum(["large", "normal", "small"]).default("large"),
  slideshow_interval: z.number().default(5),
  // Duplicate detection settings
  duplicate_sensitivity: z.enum(["strict", "normal", "loose"]).default("normal"),
  duplicate_clear_existing: z.boolean().default(false),
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
  // Deprecated: kept for backward compatibility
  skip_raw_files: z.boolean().optional(),
  // Stack RAW+JPEG pairs automatically during scans
  stack_raw_jpeg: z.boolean().optional(),
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

// Row shape returned by the GET /api/user/ list (and a /user/<id>/ retrieve of
// someone else's record). Since the #1861 authorization fix the backend only
// serializes the full UserSerializer for admins and for a user viewing their own
// record; every other reader receives the public-safe PublicUserSerializer
// (id, avatar_url, username, first/last name, public_photo_count,
// public_photo_samples, public_sharing). Validating those rows against the full
// `User` schema spammed non-admins with "Required at results.N.<field>" popups
// (issue #1888), so here the private/admin-only fields are optional while the
// public-safe fields stay required.
export const ListUser = User.partial().required({
  id: true,
  username: true,
  first_name: true,
  last_name: true,
  public_photo_count: true,
  public_photo_samples: true,
});
export type ListUser = z.infer<typeof ListUser>;

export const ListUserList = ListUser.array();
export type ListUserList = z.infer<typeof ListUserList>;

export type UserState = {
  userSelfDetails: User;
  error: Error | string | null | undefined;
};
