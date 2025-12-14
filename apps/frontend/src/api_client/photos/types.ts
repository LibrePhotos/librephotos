import { z } from "zod";

export const SimpleUser = z.object({
  id: z.number(),
  username: z.string(),
  first_name: z.string(),
  last_name: z.string(),
});
export type SimpleUser = z.infer<typeof SimpleUser>;

export enum Media {
  IMAGE = "image",
  VIDEO = "video",
  MOTION_PHOTO = "motion_photo",
}

export const PigPhoto = z.object({
  id: z.string(),
  dominantColor: z.string().optional(),
  url: z.string().optional(),
  location: z.string().optional(),
  date: z.string().optional().nullable(),
  birthTime: z.string().optional(),
  aspectRatio: z.number(),
  type: z.nativeEnum(Media).default(Media.IMAGE),
  video_length: z.string().optional(),
  rating: z.number().default(0),
  owner: SimpleUser.optional(),
  shared_to: SimpleUser.array().default([]),
  isTemp: z.boolean().default(false),
});
export type PigPhoto = z.infer<typeof PigPhoto>;

export enum Photoset {
  NONE = "none",
  TIMESTAMP = "timestamp",
  NO_TIMESTAMP = "noTimestamp",
  FAVORITES = "favorites",
  PHOTOS = "photos",
  HIDDEN = "hidden",
  RECENTLY_ADDED = "recentlyAdded",
  IN_TRASHCAN = "in_trashcan",
  SEARCH = "search",
  USER_ALBUM = "userAlbum",
  PERSON = "person",
  PUBLIC = "public",
  SHARED_TO_ME = "sharedToMe",
  SHARED_BY_ME = "sharedByMe",
  VIDEOS = "videos",
}

export const SharedFromMePhoto = z.object({
  user_id: z.number(),
  user: SimpleUser,
  photo: PigPhoto,
});

export const PhotoHash = z.object({
  image_hash: z.string(),
  video: z.boolean(),
});

export const People = z.object({
  name: z.string(),
  type: z.string(),
  probability: z.number(),
  location: z.object({ top: z.number(), bottom: z.number(), left: z.number(), right: z.number() }),
  face_url: z.string(),
  face_id: z.number(),
});

export const Photo = z.object({
  camera: z.string().nullable(),
  exif_gps_lat: z.number().nullable(),
  exif_gps_lon: z.number().nullable(),
  exif_timestamp: z.string().nullable(),
  search_captions: z.string().nullable(),
  search_location: z.string().nullable(),
  captions_json: z.any().nullable(),
  big_thumbnail_url: z.string().nullable(),
  small_square_thumbnail_url: z.string().nullable(),
  geolocation_json: z.any().nullable(),
  exif_json: z.any().nullable(),
  people: People.array(),
  image_hash: z.string(),
  image_path: z.string().array(),
  rating: z.number(),
  hidden: z.boolean(),
  public: z.boolean(),
  in_trashcan: z.boolean(),
  removed: z.boolean(),
  size: z.number(),
  shared_to: z.number().nullable().array(), // TODO: There are sometimes items in the array with value null. Why?!?
  similar_photos: z.object({ image_hash: z.string(), type: z.nativeEnum(Media) }).array(),
  video: z.boolean(),
  owner: SimpleUser,
  shutter_speed: z.string().nullable(),
  height: z.number().nullable(),
  width: z.number().nullable(),
  fstop: z.number().nullable(),
  iso: z.number().nullable(),
  focal_length: z.number().nullable(),
  focalLength35Equivalent: z.number().nullable(),
  subjectDistance: z.number().nullable(),
  digitalZoomRatio: z.number().nullable(),
  lens: z.string().nullable(),
  embedded_media: z.object({ id: z.string(), type: z.nativeEnum(Media) }).array(),
});
export type Photo = z.infer<typeof Photo>;

export const DatePhotosGroup = z.object({
  date: z.string().nullable(),
  year: z.number().nullable().optional(),
  month: z.number().nullable().optional(),
  location: z.string().nullable(),
  items: PigPhoto.array(),
});
export type DatePhotosGroup = z.infer<typeof DatePhotosGroup>;

export const IncompleteDatePhotosGroup = DatePhotosGroup.extend({
  id: z.string(),
  incomplete: z.boolean(),
  numberOfItems: z.number(),
});
export type IncompleteDatePhotosGroup = z.infer<typeof IncompleteDatePhotosGroup>;

// Bulk selection types for server-side "Select All" operations
export const BulkPhotoQuery = z.object({
  favorite: z.boolean().optional(),
  public: z.boolean().optional(),
  hidden: z.boolean().optional(),
  in_trashcan: z.boolean().optional(),
  video: z.boolean().optional(),
  photo: z.boolean().optional(),
  person: z.number().optional(),
  folder: z.string().optional(),
  username: z.string().optional(),
});
export type BulkPhotoQuery = z.infer<typeof BulkPhotoQuery>;

// Selection state for photolist components
export type SelectionState = {
  selectedItems: PigPhoto[];
  selectMode: boolean;
  // Server-side select all support
  selectAllMode: boolean;
  selectAllQuery?: BulkPhotoQuery;
  // Total count of photos for display in select all mode
  totalCount?: number;
};
