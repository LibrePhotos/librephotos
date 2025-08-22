import { z } from "zod";

import {
  DatePhotosGroup,
  IncompleteDatePhotosGroup,
  PhotoHash,
  SimpleUser,
} from "../photos/types";


const UserAlbumResponse = z.object({
  id: z.number(),
  title: z.string(),
  cover_photo: PhotoHash,
  photo_count: z.number(),
  owner: SimpleUser,
  shared_to: SimpleUser.array(),
  created_on: z.string(),
  favorited: z.boolean(),
  public: z.boolean().optional(),
});

const UserAlbumList = UserAlbumResponse.array();

export const UserAlbumListResponse = z.object({
  results: UserAlbumList,
});

export type UserAlbumList = z.infer<typeof UserAlbumList>;

export type DeleteUserAlbumParams = {
  id: string;
  albumTitle: string;
};

export type RenameUserAlbumParams = {
  id: string;
  title: string;
  newTitle: string;
};

export type CreateUserAlbumParams = {
  title: string;
  photos: string[];
};

export type RemovePhotoFromUserAlbumParams = {
  id: string;
  title: string;
  photos: string[];
};

export type AddPhotoFromUserAlbumParams = {
  id: string;
  title: string;
  photos: string[];
};

export type SetUserAlbumCoverParams = {
  id: string;
  photo: string;
};

export const Person = z.object({
  name: z.string(),
  face_url: z.string().nullable(),
  face_count: z.number(),
  face_photo_url: z.string().nullable(),
  video: z.boolean().optional(),
  id: z.number(),
  newPersonName: z.string().optional(),
  cover_photo: z.string().optional(),
});

export const PersonInfo = z.object({
  id: z.string(),
  name: z.string(),
});
export type PersonInfo = z.infer<typeof PersonInfo>;
export const PersonList = z.array(Person);

export const Node = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
});

export const Link = z.object({
  source: z.string(),
  target: z.string(),
});

export const PersonDataPointList = z.object({
  nodes: Node.array(),
  links: Link.array(),
});

export const PhotoSuperSimple = z.object({
  image_hash: z.string(),
  exif_timestamp: z.string().nullable(),
  rating: z.number(),
  geolocation_json: z.any(),
  hidden: z.boolean(),
  public: z.boolean(),
  video: z.boolean(),
});

const AlbumInfo = z.object({
  id: z.number(),
  title: z.string(),
  cover_photos: PhotoHash.array(),
  photo_count: z.number(),
});
export type AlbumInfo = z.infer<typeof AlbumInfo>;

const ThingAlbum = z.object({
  id: z.string(),
  title: z.string(),
  grouped_photos: DatePhotosGroup.array(),
});
export type ThingAlbum = z.infer<typeof ThingAlbum>;

export const UserAlbumInfo = z.object({
  id: z.number(),
  title: z.string(),
  cover_photo: PhotoSuperSimple,
  photo_count: z.number(),
  owner: SimpleUser,
  shared_to: SimpleUser.array(),
  created_on: z.string(),
  favorited: z.boolean(),
  public: z.boolean().optional(),
});
export type UserAlbumInfo = z.infer<typeof UserAlbumInfo>;

const UserAlbumDetails = z.object({
  id: z.string(),
  title: z.string(),
  owner: SimpleUser,
  shared_to: SimpleUser.array().optional(),

  date: z.string(),
  location: z.string().nullable(),
});
export type UserAlbumDetails = z.infer<typeof UserAlbumDetails>;

export const UserAlbum = UserAlbumDetails.extend({
  grouped_photos: DatePhotosGroup.array(),
  public: z.boolean().optional(),
  public_slug: z.string().optional(),
  public_expires_at: z.string().nullable().optional(),
});

export type UserAlbum = z.infer<typeof UserAlbum>;

export const FetchThingAlbumsListResponse = z.object({
  results: AlbumInfo.array(),
});

export const FetchThingAlbumResponse = z.object({
  results: ThingAlbum,
});

export const FetchUserAlbumsListResponse = z.object({
  results: UserAlbumInfo.array(),
});

export const UserAlbumEdit = z.object({
  id: z.number(),
  title: z.string().nullable(),
  photos: z.string().array(),
  created_on: z.string(),
  favorited: z.boolean(),
  removedPhotos: z.string().array().optional(),
});

export const PlaceAlbumInfo = AlbumInfo.extend({
  geolocation_level: z.number(),
});
export type PlaceAlbumInfo = z.infer<typeof PlaceAlbumInfo>;
export const FetchPlaceAlbumsListResponse = z.object({
  results: PlaceAlbumInfo.array(),
});

export const PlaceAlbum = z.object({
  id: z.string(),
  title: z.string(),
  grouped_photos: DatePhotosGroup.array(),
});

export const PhotoSimple = z.object({
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

export const AutoAlbum = z.object({
  id: z.number(),
  title: z.string(),
  favorited: z.boolean(),
  timestamp: z.string(),
  created_on: z.string(),
  gps_lat: z.number().nullable(),
  people: Person.array(),
  gps_lon: z.number().nullable(),
  photos: PhotoSimple.array(),
});
export type AutoAlbum = z.infer<typeof AutoAlbum>;

export const AutoAlbumInfo = z.object({
  id: z.number(),
  title: z.string(),
  timestamp: z.string(),
  photos: PhotoHash, // TODO: This is a single photo, so the property name should be corrected. Perhaps cover_photo?
  photo_count: z.number(),
  favorited: z.boolean(),
});
export type AutoAlbumInfo = z.infer<typeof AutoAlbumInfo>;

// actions using new list view in backend

export const FetchAutoAlbumsListResponse = z.object({
  results: AutoAlbumInfo.array(),
});

export const FetchDateAlbumsListResponse = z.object({
  results: IncompleteDatePhotosGroup.array(),
});
export const FetchDateAlbumResponse = z.object({
  results: IncompleteDatePhotosGroup,
});

export const FetchUserAlbumsSharedResponse = z.object({
  results: UserAlbumInfo.array(),
});



