import {
  DatePhotosGroup,
  DatePhotosGroupSchema,
  IncompleteDatePhotosGroup,
  IncompleteDatePhotosGroupSchema,
  PersonInfo,
  PersonInfoSchema,
  PhotoHashSchema,
  SimpleUserSchema,
} from "./photosActions.types";

import { z } from "zod";

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

export const UserAlbumInfoSchema = AlbumInfoSchema.extend({
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

export const _FetchThingAlbumsListResponseSchema = z.object({
  results: AlbumInfoSchema.array(),
});

export const _FetchThingAlbumResponseSchema = z.object({
  results: ThingAlbumSchema,
});

export const _FetchUserAlbumsListResponseSchema = z.object({
  results: UserAlbumInfoSchema.array(),
});

export const _UserAlbumEditResponseSchema = z.object({
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
export const _FetchPlaceAlbumsListResponseSchema = z.object({
  results: PlaceAlbumInfoSchema.array(),
});

export const PlaceAlbumSchema = z.object({
  id: z.string(),
  title: z.string(),
  grouped_photos: DatePhotosGroupSchema.array(),
});

export const PersonSchema = z.object({
  name: z.string(),
  face_url: z.string().nullable(),
  face_count: z.number(),
  face_photo_url: z.string().nullable(),
  id: z.number(),
  newPersonName: z.string().optional(),
});
export const PhotoSimpleSchema = z.object({
  square_thumbnail: z.string(),
  image: z.string().nullable(),
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

//actions using new list view in backend

export const _FetchAutoAlbumsListResponseSchema = z.object({
  results: AutoAlbumInfoSchema.array(),
});

export const _FetchDateAlbumsListResponseSchema = z.object({
  results: IncompleteDatePhotosGroupSchema.array(),
});

export const _FetchUserAlbumsSharedResponseSchema = z.object({
  results: UserAlbumInfoSchema.array(),
});
