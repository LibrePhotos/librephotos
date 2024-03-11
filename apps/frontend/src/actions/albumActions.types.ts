import { z } from "zod";

import { PersonSchema } from "./peopleActions.types";
import {
  DatePhotosGroupSchema,
  IncompleteDatePhotosGroupSchema,
  PhotoHashSchema,
  SimpleUserSchema,
} from "./photosActions.types";

export const PhotoSuperSimpleSchema = z.object({
  image_hash: z.string(),
  exif_timestamp: z.string().nullable(),
  rating: z.number(),
  geolocation_json: z.any(),
  hidden: z.boolean(),
  public: z.boolean(),
  video: z.boolean(),
});

const AlbumInfoSchema = z.object({
  id: z.number(),
  title: z.string(),
  cover_photos: PhotoHashSchema.array(),
  photo_count: z.number(),
});
export type AlbumInfo = z.infer<typeof AlbumInfoSchema>;

const ThingAlbumSchema = z.object({
  id: z.string(),
  title: z.string(),
  grouped_photos: DatePhotosGroupSchema.array(),
});
export type ThingAlbum = z.infer<typeof ThingAlbumSchema>;

export const UserAlbumInfoSchema = z.object({
  id: z.number(),
  title: z.string(),
  cover_photo: PhotoSuperSimpleSchema,
  photo_count: z.number(),
  owner: SimpleUserSchema,
  shared_to: SimpleUserSchema.array(),
  created_on: z.string(),
  favorited: z.boolean(),
});
export type UserAlbumInfo = z.infer<typeof UserAlbumInfoSchema>;

const UserAlbumDetailsSchema = z.object({
  id: z.string(),
  title: z.string(),
  owner: SimpleUserSchema,
  shared_to: SimpleUserSchema.array(),

  date: z.string(),
  location: z.string().nullable(),
});
export type UserAlbumDetails = z.infer<typeof UserAlbumDetailsSchema>;

export const UserAlbumSchema = UserAlbumDetailsSchema.extend({
  grouped_photos: DatePhotosGroupSchema.array(),
});

export const FetchThingAlbumsListResponseSchema = z.object({
  results: AlbumInfoSchema.array(),
});

export const FetchThingAlbumResponseSchema = z.object({
  results: ThingAlbumSchema,
});

export const FetchUserAlbumsListResponseSchema = z.object({
  results: UserAlbumInfoSchema.array(),
});

export const UserAlbumEditResponseSchema = z.object({
  id: z.number(),
  title: z.string().nullable(),
  photos: z.string().array(),
  created_on: z.string(),
  favorited: z.boolean(),
  removedPhotos: z.string().array().optional(),
});

export const PlaceAlbumInfoSchema = AlbumInfoSchema.extend({
  geolocation_level: z.number(),
});
export type PlaceAlbumInfo = z.infer<typeof PlaceAlbumInfoSchema>;
export const FetchPlaceAlbumsListResponseSchema = z.object({
  results: PlaceAlbumInfoSchema.array(),
});

export const PlaceAlbumSchema = z.object({
  id: z.string(),
  title: z.string(),
  grouped_photos: DatePhotosGroupSchema.array(),
});

export const PhotoSimpleSchema = z.object({
  square_thumbnail: z.string(),
  image_hash: z.string(),
  exif_timestamp: z.string(),
  exif_gps_lat: z.number().nullable(),
  exif_gps_lon: z.number().nullable(),
  rating: z.number(),
  geolocation_json: z.any(),
  public: z.boolean(),
  video: z.boolean(),
});

export const AutoAlbumSchema = z.object({
  id: z.number(),
  title: z.string(),
  favorited: z.boolean(),
  timestamp: z.string(),
  created_on: z.string(),
  gps_lat: z.number().nullable(),
  people: PersonSchema.array(),
  gps_lon: z.number().nullable(),
  photos: PhotoSimpleSchema.array(),
});
export type AutoAlbum = z.infer<typeof AutoAlbumSchema>;

export const AutoAlbumInfoSchema = z.object({
  id: z.number(),
  title: z.string(),
  timestamp: z.string(),
  photos: PhotoHashSchema, // TODO: This is a single photo, so the property name should be corrected. Perhaps cover_photo?
  photo_count: z.number(),
  favorited: z.boolean(),
});
export type AutoAlbumInfo = z.infer<typeof AutoAlbumInfoSchema>;

// actions using new list view in backend

export const FetchAutoAlbumsListResponseSchema = z.object({
  results: AutoAlbumInfoSchema.array(),
});

export const FetchDateAlbumsListResponseSchema = z.object({
  results: IncompleteDatePhotosGroupSchema.array(),
});
export const FetchDateAlbumResponseSchema = z.object({
  results: IncompleteDatePhotosGroupSchema,
});

export const FetchUserAlbumsSharedResponseSchema = z.object({
  results: UserAlbumInfoSchema.array(),
});
