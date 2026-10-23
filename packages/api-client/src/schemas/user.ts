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

/**
 * What the main timeline shows when its URL names no filter (issue #2130).
 * Every key is optional and an empty object shows everything. The server
 * validates what is saved; a value written past the API never fails the
 * whole user: a bad key is dropped, anything but an object becomes {}.
 */
export const TimelineFilterDefault = z
  .object({
    media: z.enum(["all", "photos", "videos"]).optional().catch(undefined),
    hide_screenshots: z.boolean().optional().catch(undefined),
    hide_documents: z.boolean().optional().catch(undefined),
    favorites: z.boolean().optional().catch(undefined),
  })
  .catch({});
export type TimelineFilterDefault = z.infer<typeof TimelineFilterDefault>;

/** How a user rates photos (#2202): the favorite toggle, or 1-5 stars. */
export const RatingMode = z.enum(["favorite", "stars"]);
export type RatingMode = z.infer<typeof RatingMode>;

export const User = z.object({
  id: z.number(),
  username: z.string(),
  email: z.string(),
  scan_directory: z.string().optional(),
  // Empty means the "uploads" folder inside scan_directory. Without it here zod
  // stripped the field, and the Edit User dialog showed an empty upload folder.
  upload_directory: z.string().nullish(),
  confidence: z.number(),
  // Unused since #2196 and no longer editable; the server still sends it, and a
  // client must not fail a user over it, so it is optional.
  confidence_person: z.number().optional(),
  transcode_videos: z.boolean(),
  semantic_search_topk: z.number(),
  first_name: z.string(),
  public_photo_samples: z.array(PublicPhotoSample),
  last_name: z.string(),
  public_photo_count: z.number(),
  date_joined: z.string(),
  // The avatar's URL (an ImageField); a client never sends it back as one.
  avatar: z.string().nullish(),
  photo_count: z.number(),
  nextcloud_server_address: z.string().nullish(),
  nextcloud_username: z.string().nullish(),
  nextcloud_app_password: z.string().optional(),
  nextcloud_scan_directory: z.string().nullish(),
  avatar_url: z.string().nullish(),
  favorite_min_rating: z.number(),
  // How the web rates photos (#2202): a favorite toggle, or 1-5 stars.
  // Servers before #2202 do not send it, so it defaults to the toggle.
  rating_mode: RatingMode.default("favorite"),
  image_scale: z.number(),
  save_metadata_to_disk: z.string(),
  save_face_tags_to_disk: z.boolean().default(false),
  datetime_rules: z.string(),
  // A JSON list of rules, or the JSON string encoding one: the server stores
  // what a client saved.
  burst_detection_rules: z.unknown().optional(),
  default_timezone: z.string(),
  // Read nowhere and read-only since #2219; the server still sends both until
  // the columns are dropped, and a client must not fail a user over them.
  skip_raw_files: z.boolean().optional(),
  stack_raw_jpeg: z.boolean().optional(),
  password: z.string().optional(),
  is_superuser: z.boolean().optional(),
  public_sharing: z.boolean(),
  // Unused since #2196 (see confidence_person).
  confidence_unknown_face: z.number().optional(),
  min_cluster_size: z.number(),
  min_samples: z.number(),
  cluster_selection_epsilon: z.number(),
  // Detected faces lower than this share of the photo's shorter side are not saved (#2749); 0 is
  // off. Optional: older servers do not send it, and the settings page then hides it.
  min_face_size: z.number().optional(),
  // The caption context switches (the name is from the LLM era). The server
  // stores whatever a client saved there, so it stays `unknown`: readers narrow
  // each key on its own, and a settings save sends the other keys back unchanged.
  llm_settings: z.unknown(),
  public_sharing_defaults: PublicSharingDefaults.optional(),
  // Whether the users this user shares with see the people they named (#2722). Optional: older
  // servers do not send it, and off is what they do.
  share_people_names: z.boolean().optional(),
  text_alignment: z.enum(["left", "right"]).default("right"),
  header_size: z.enum(["large", "normal", "small"]).default("large"),
  // How the scroll scrubber beside a photo list looks. Optional: older servers do not send it, and
  // the web app then shows the thumb.
  scrubber_style: z.enum(["thumb", "density"]).optional(),
  slideshow_interval: z.number().default(5),
  duplicate_sensitivity: z.enum(["strict", "normal", "loose"]).default("normal"),
  duplicate_clear_existing: z.boolean().default(false),
  default_timeline_filter: TimelineFilterDefault.optional().default({}),
  // The What's new card (#2305): the release whose card the user last closed or opened ("" before
  // the first), and whether the card shows after an update. Optional: an older server has neither,
  // and the web app then shows no card, since it could not remember that it was closed.
  last_seen_release: z.string().optional(),
  show_whats_new: z.boolean().optional(),
});
export type User = z.infer<typeof User>;

export const UserList = User.array();
export type UserList = z.infer<typeof UserList>;

/**
 * The public-safe row shape returned by GET /api/user/ to non-admins. Private
 * fields are optional; only the public-safe columns are required (issue #1888).
 */
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
  // Empty means the "uploads" folder inside scan_directory
  upload_directory: z.string().nullish(),
  semantic_search_topk: z.number(),
  // Read-only since #2219 (see User).
  skip_raw_files: z.boolean().optional(),
  stack_raw_jpeg: z.boolean().optional(),
  username: z.string().optional(),
  email: z.string().nullable(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  password: z.string().optional(),
});
export type ManageUser = z.infer<typeof ManageUser>;

/** `GET /manage/user/<id>/scan-directory-impact/` (admin, #2036): photos a new scan directory leaves outside. */
export const ScanDirectoryImpact = z.object({
  outside_count: z.number(),
});
export type ScanDirectoryImpact = z.infer<typeof ScanDirectoryImpact>;

/**
 * One folder of a user's library (#123): the scan directory (`main`), a further library folder an
 * admin added (`folder`, with its id to remove it), or the upload folder when it lies outside them.
 */
export const LibraryFolderEntry = z.object({
  id: z.number().nullable(),
  path: z.string(),
  kind: z.enum(["main", "folder", "upload"]),
  /** The folder can be read now; a scan skips it otherwise and does not flag its photos missing. */
  available: z.boolean(),
  photo_count: z.number(),
});
export type LibraryFolderEntry = z.infer<typeof LibraryFolderEntry>;

/** `GET /library-folders/` and `/manage/user/<id>/library-folders/`: every folder of a library, the main one first. */
export const LibraryFolders = z.object({
  folders: z.array(LibraryFolderEntry),
  /** Folders inside them the user left out of the library (#791). */
  excluded_folders: z.array(z.string()),
});
export type LibraryFolders = z.infer<typeof LibraryFolders>;

/** `PUT /library-folders/excluded/` (#791): the library, and the photos now outside it. */
export const ExcludedFoldersSaved = LibraryFolders.extend({
  outside_count: z.number(),
});
export type ExcludedFoldersSaved = z.infer<typeof ExcludedFoldersSaved>;

/** A folder inside a library folder, for the tree the user leaves folders out in (#791). */
export const LibrarySubfolder = z.object({
  name: z.string(),
  path: z.string(),
  excluded: z.boolean(),
  has_subfolders: z.boolean(),
  photo_count: z.number(),
});
export type LibrarySubfolder = z.infer<typeof LibrarySubfolder>;

/** `GET /library-folders/subfolders/?path=`: the folders inside one folder of the library. */
export const LibrarySubfolders = z.object({
  path: z.string(),
  subfolders: z.array(LibrarySubfolder),
  truncated: z.boolean(),
});
export type LibrarySubfolders = z.infer<typeof LibrarySubfolders>;
