import { z } from "zod";
import { DatePhotosGroup, IncompleteDatePhotosGroup, PhotoHash, SimpleUser, UuidString } from "./common";
import { Person } from "./persons";

/* ---- Date albums (the timeline) ---------------------------------------- */

export const FetchDateAlbumsListResponse = z.object({
  results: IncompleteDatePhotosGroup.array(),
});
export type FetchDateAlbumsListResponse = z.infer<typeof FetchDateAlbumsListResponse>;

export const FetchDateAlbumResponse = z.object({
  results: IncompleteDatePhotosGroup,
});
export type FetchDateAlbumResponse = z.infer<typeof FetchDateAlbumResponse>;

/* ---- User albums ------------------------------------------------------- */

export const PhotoSuperSimple = z.object({
  image_hash: z.string(),
  exif_timestamp: z.string().nullable(),
  rating: z.number(),
  geolocation_json: z.any(),
  hidden: z.boolean(),
  public: z.boolean(),
  video: z.boolean(),
});
export type PhotoSuperSimple = z.infer<typeof PhotoSuperSimple>;

export const UserAlbumInfo = z.object({
  id: z.number(),
  title: z.string(),
  cover_photo: PhotoSuperSimple.nullable(),
  photo_count: z.number(),
  owner: SimpleUser,
  shared_to: SimpleUser.array(),
  created_on: z.string(),
  favorited: z.boolean(),
  locked: z.boolean(),
  public: z.boolean().optional(),
});
export type UserAlbumInfo = z.infer<typeof UserAlbumInfo>;

export const FetchUserAlbumsListResponse = z.object({
  results: UserAlbumInfo.array(),
});
export type FetchUserAlbumsListResponse = z.infer<typeof FetchUserAlbumsListResponse>;

const UserAlbumDetails = z.object({
  id: z.string(),
  title: z.string(),
  owner: SimpleUser,
  // Public album responses omit the lock flag; they are already read-only.
  shared_to: SimpleUser.array().optional(),
  locked: z.boolean().default(false),
  date: z.string(),
  location: z.string().nullable(),
});

/** Per-album overrides of the owner's public sharing defaults; null = use the default. */
export const PublicSharingOptions = z.object({
  share_location: z.boolean().nullable().optional(),
  share_camera_info: z.boolean().nullable().optional(),
  share_timestamps: z.boolean().nullable().optional(),
  share_captions: z.boolean().nullable().optional(),
  share_faces: z.boolean().nullable().optional(),
});
export type PublicSharingOptions = z.infer<typeof PublicSharingOptions>;

export const UserAlbum = UserAlbumDetails.extend({
  grouped_photos: DatePhotosGroup.array(),
  public: z.boolean().optional(),
  public_slug: z.string().optional(),
  public_expires_at: z.string().nullable().optional(),
  public_sharing_options: PublicSharingOptions.nullable().optional(),
});
export type UserAlbum = z.infer<typeof UserAlbum>;

export const FetchUserAlbumsSharedResponse = z.object({
  results: UserAlbumInfo.array(),
});
export type FetchUserAlbumsSharedResponse = z.infer<typeof FetchUserAlbumsSharedResponse>;

/* ---- Auto (event) albums ---------------------------------------------- */

export const AutoAlbumInfo = z.object({
  id: z.number(),
  title: z.string(),
  timestamp: z.string(),
  photos: PhotoHash,
  photo_count: z.number(),
  favorited: z.boolean(),
});
export type AutoAlbumInfo = z.infer<typeof AutoAlbumInfo>;

export const FetchAutoAlbumsListResponse = z.object({
  results: AutoAlbumInfo.array(),
});
export type FetchAutoAlbumsListResponse = z.infer<typeof FetchAutoAlbumsListResponse>;

export const PhotoSimple = z.object({
  id: UuidString,
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
export type PhotoSimple = z.infer<typeof PhotoSimple>;

export const AutoAlbum = z.object({
  id: z.number(),
  title: z.string(),
  favorited: z.boolean(),
  timestamp: z.string(),
  created_on: z.string(),
  gps_lat: z.number().nullable(),
  gps_lon: z.number().nullable(),
  /** The people whose (non-deleted) faces appear in the album's photos. */
  people: Person.array(),
  photos: PhotoSimple.array(),
});
export type AutoAlbum = z.infer<typeof AutoAlbum>;

/* ---- Thing / Place albums --------------------------------------------- */

export const AlbumInfo = z.object({
  id: z.number(),
  title: z.string(),
  cover_photos: PhotoHash.array(),
  photo_count: z.number(),
});
export type AlbumInfo = z.infer<typeof AlbumInfo>;

/** `thing_type` is where the label came from, e.g. "places365_attribute" or "hashtag_attribute". */
export const ThingAlbumInfo = AlbumInfo.extend({
  thing_type: z.string().nullable(),
});
export type ThingAlbumInfo = z.infer<typeof ThingAlbumInfo>;

export const FetchThingAlbumsListResponse = z.object({
  results: ThingAlbumInfo.array(),
});
export type FetchThingAlbumsListResponse = z.infer<typeof FetchThingAlbumsListResponse>;

export const ThingAlbum = z.object({
  id: z.string(),
  title: z.string(),
  grouped_photos: DatePhotosGroup.array(),
});
export type ThingAlbum = z.infer<typeof ThingAlbum>;

export const FetchThingAlbumResponse = z.object({
  results: ThingAlbum,
});
export type FetchThingAlbumResponse = z.infer<typeof FetchThingAlbumResponse>;

export const PlaceAlbumInfo = AlbumInfo.extend({
  geolocation_level: z.number(),
});
export type PlaceAlbumInfo = z.infer<typeof PlaceAlbumInfo>;

export const FetchPlaceAlbumsListResponse = z.object({
  results: PlaceAlbumInfo.array(),
});
export type FetchPlaceAlbumsListResponse = z.infer<typeof FetchPlaceAlbumsListResponse>;

export const PlaceAlbum = z.object({
  id: z.string(),
  title: z.string(),
  grouped_photos: DatePhotosGroup.array(),
});
export type PlaceAlbum = z.infer<typeof PlaceAlbum>;

export const FetchPlaceAlbumResponse = z.object({
  results: PlaceAlbum,
});
export type FetchPlaceAlbumResponse = z.infer<typeof FetchPlaceAlbumResponse>;

/* ---- Mutation params (platform-agnostic) ------------------------------ */

export type CreateUserAlbumParams = { title: string; photos: string[] };
export type DeleteUserAlbumParams = { id: string; albumTitle: string };
export type RenameUserAlbumParams = { id: string; title: string; newTitle: string };
export type AddPhotoToUserAlbumParams = { id: string; title: string; photos: string[] };
export type RemovePhotoFromUserAlbumParams = { id: string; title: string; photos: string[] };
