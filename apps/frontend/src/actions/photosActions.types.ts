import { z } from "zod";

export const SimpleUserSchema = z.object({
  id: z.number(),
  username: z.string(),
  first_name: z.string(),
  last_name: z.string(),
});
export type SimpleUser = z.infer<typeof SimpleUserSchema>;

export enum MediaType {
  IMAGE = "image",
  VIDEO = "video",
  MOTION_PHOTO = "motion_photo",
}

export const PigPhotoSchema = z.object({
  id: z.string(),
  dominantColor: z.string().optional(),
  url: z.string().optional(),
  location: z.string().optional(),
  date: z.string().optional().nullable(),
  birthTime: z.string().optional(),
  aspectRatio: z.number(),
  type: z.nativeEnum(MediaType).default(MediaType.IMAGE),
  video_length: z.string().optional(),
  rating: z.number().default(0),
  owner: SimpleUserSchema.optional(),
  shared_to: SimpleUserSchema.array().default([]),
  isTemp: z.boolean().default(false),
});
export type PigPhoto = z.infer<typeof PigPhotoSchema>;

export const SharedFromMePhotoSchema = z.object({
  user_id: z.number(),
  user: SimpleUserSchema,
  photo: PigPhotoSchema,
});

export const PhotoHashSchema = z.object({
  image_hash: z.string(),
  video: z.boolean(),
});

export const PeopleSchema = z.object({
  name: z.string(),
  type: z.string(),
  probability: z.number(),
  location: z.object({ top: z.number(), bottom: z.number(), left: z.number(), right: z.number() }),
  face_url: z.string(),
  face_id: z.number(),
});

export const PhotoSchema = z.object({
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
  people: PeopleSchema.array(),
  image_hash: z.string(),
  image_path: z.string().array(),
  rating: z.number(),
  hidden: z.boolean(),
  public: z.boolean(),
  in_trashcan: z.boolean(),
  removed: z.boolean(),
  size: z.number(),
  shared_to: z.number().nullable().array(), // TODO: There are sometimes items in the array with value null. Why?!?
  similar_photos: z.object({ image_hash: z.string(), type: z.nativeEnum(MediaType) }).array(),
  video: z.boolean(),
  owner: SimpleUserSchema,
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
  embedded_media: z.object({ id: z.string(), type: z.nativeEnum(MediaType) }).array(),
});
export type Photo = z.infer<typeof PhotoSchema>;

export const DatePhotosGroupSchema = z.object({
  date: z.string().nullable(),
  year: z.number().nullable().optional(),
  month: z.number().nullable().optional(),
  location: z.string().nullable(),
  items: PigPhotoSchema.array(),
});
export type DatePhotosGroup = z.infer<typeof DatePhotosGroupSchema>;

export const IncompleteDatePhotosGroupSchema = DatePhotosGroupSchema.extend({
  id: z.string(),
  incomplete: z.boolean(),
  numberOfItems: z.number(),
});
export type IncompleteDatePhotosGroup = z.infer<typeof IncompleteDatePhotosGroupSchema>;
