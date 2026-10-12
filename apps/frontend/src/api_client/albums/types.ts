import type { BulkPhotoQuery, UserAlbumInfo } from "@librephotos/api-client";

// The album schemas are shared with the mobile app and live in
// packages/api-client; this module re-exports them under their old names.
export { AutoAlbumInfo, UserAlbum, UserAlbumInfo } from "@librephotos/api-client";

export type UserAlbumList = UserAlbumInfo[];

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
