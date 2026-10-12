import {
  IntegerId,
  PhotoHash,
  UserAlbumInfo as SharedUserAlbumInfo,
  type BulkPhotoQuery,
} from "@librephotos/api-client";
import { z } from "zod";

// The album schemas are shared with the mobile app and live in
// packages/api-client; this module re-exports them under their old names.
export { AutoAlbumInfo, FetchDateAlbumResponse, FetchDateAlbumsListResponse, UserAlbum } from "@librephotos/api-client";

// Frontend album lists return a lightweight cover photo. Keep the shared album
// fields while using that same shape throughout the UI. `locked` is optional
// (absent from servers before #2146; absent means unlocked). No .default()
// here: with zod 3 parseWithNotification typed its result by the schema
// input, and a default left the parsed and declared album types apart.
export const UserAlbumInfo = SharedUserAlbumInfo.extend({
  cover_photo: PhotoHash.nullable(),
  locked: z.boolean().optional(),
});
export type UserAlbumInfo = z.infer<typeof UserAlbumInfo>;

const UserAlbumList = UserAlbumInfo.array();

export const UserAlbumListResponse = z.object({
  results: UserAlbumList,
});

export type UserAlbumList = z.infer<typeof UserAlbumList>;

/** GET /public/albums/s/{slug}/, read only for the id of the album that holds the slug. */
export const SlugOwnerResponse = z.object({
  results: z.object({ id: IntegerId }),
});

export type DeleteUserAlbumParams = {
  id: string;
  albumTitle: string;
};

export type RenameUserAlbumParams = {
  id: string;
  title: string;
  newTitle: string;
};

export type ToggleUserAlbumLockedParams = {
  id: string;
  locked: boolean;
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
