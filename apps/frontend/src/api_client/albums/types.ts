import { PhotoHash, SimpleUser, type BulkPhotoQuery, type UserAlbum } from "@librephotos/api-client";
import { z } from "zod";

// The album schemas are shared with the mobile app and live in
// packages/api-client; this module re-exports them under their old names.
export {
  AlbumInfo,
  AutoAlbum,
  AutoAlbumInfo,
  FetchAutoAlbumsListResponse,
  FetchDateAlbumResponse,
  FetchDateAlbumsListResponse,
  FetchPlaceAlbumResponse,
  FetchPlaceAlbumsListResponse,
  FetchThingAlbumResponse,
  FetchThingAlbumsListResponse,
  FetchUserAlbumsListResponse,
  FetchUserAlbumsSharedResponse,
  Person,
  PersonList,
  PhotoSimple,
  PhotoSuperSimple,
  PlaceAlbum,
  PlaceAlbumInfo,
  PublicSharingOptions,
  ThingAlbum,
  ThingAlbumInfo,
  UserAlbum,
  UserAlbumInfo,
} from "@librephotos/api-client";

// What useFetchUserAlbumsQuery parses /albums/user/list/ with. It differs from
// the shared UserAlbumInfo (cover_photo: PhotoSuperSimple | null), which the
// album pages are not typed for yet; see the migration checklist.
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

// Server-side "Select All": instead of listing every photo id, send the query
// describing the photoset plus exclusions, mirroring the other bulk mutations.
// `photoCount` is display-only (the notification), since `photos` is empty then.
export type SelectAllAlbumFields = {
  select_all?: boolean;
  query?: BulkPhotoQuery;
  excluded_hashes?: string[];
  photoCount?: number;
};

export type CreateUserAlbumParams = SelectAllAlbumFields & {
  title: string;
  photos: string[];
};

export type RemovePhotoFromUserAlbumParams = {
  id: string;
  title: string;
  photos: string[];
};

export type AddPhotoFromUserAlbumParams = SelectAllAlbumFields & {
  id: string;
  title: string;
  photos: string[];
};

export type SetUserAlbumCoverParams = {
  id: string;
  photo: string;
};

export const PersonInfo = z.object({
  id: z.string(),
  name: z.string(),
});
export type PersonInfo = z.infer<typeof PersonInfo>;

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

export type UserAlbumDetails = Pick<UserAlbum, "id" | "title" | "owner" | "shared_to" | "date" | "location">;

export const UserAlbumEdit = z.object({
  id: z.number(),
  title: z.string().nullable(),
  photos: z.string().array(),
  created_on: z.string(),
  favorited: z.boolean(),
  removedPhotos: z.string().array().optional(),
});
