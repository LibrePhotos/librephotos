import { z } from "zod";
import * as S from "../schemas";
import { Photoset } from "../schemas";
import { ApiError, runningJobId } from "../transport/client";
import { fetchAllPages, fetchAllPagesWithFirst } from "../transport/pages";
import type { ApiClient } from "../transport/types";
import { buildQuery, parseEachResponse, parseResponse, type ParsedEntries } from "../util/parse";

/* ---------------------------------------------------------------------- *
 * Thin, platform-agnostic endpoint wrappers. Each takes an ApiClient and
 * returns parsed, typed data. No React here — hooks build on top of these.
 *
 * A list a screen shows whole is read with fetchAllPages, which follows the
 * server's `next` links; reading one page dropped every row past it.
 * ---------------------------------------------------------------------- */

/* ---- auth -------------------------------------------------------------- */

export async function login(client: ApiClient, credentials: S.LoginPost): Promise<S.LoginResponse> {
  const res = await client.post<unknown>("/auth/token/obtain/", credentials);
  return parseResponse(S.LoginResponse, res, "login response");
}

/**
 * Blacklist the refresh token. Without one (`undefined`, left out of the body) the server answers
 * 401; it clears the auth cookies either way.
 */
export async function logout(client: ApiClient, refresh: string | undefined): Promise<S.LogoutResponse> {
  const res = await client.post<unknown>("/auth/token/blacklist/", { refresh });
  return parseResponse(S.LogoutResponse, res, "logout response");
}

/** Create a user. On a fresh instance (see fetchIsFirstTimeSetup) the first one becomes the admin. */
export async function signUp(client: ApiClient, data: S.SignupRequest): Promise<S.SignupUser> {
  const res = await client.post<unknown>("/user/", data);
  return parseResponse(S.SignupUser, res, "signup response");
}

/** Whether the instance has no admin yet, so the login page offers sign-up instead. Anonymous. */
export async function fetchIsFirstTimeSetup(client: ApiClient): Promise<S.IsFirstTimeSetupResponse> {
  const res = await client.get<unknown>("/firsttimesetup/");
  return parseResponse(S.IsFirstTimeSetupResponse, res, "first-time setup");
}

/** The login screen's single sign-on setup. Anonymous: it is read before anyone is logged in. */
export async function fetchSsoConfig(client: ApiClient): Promise<S.SsoConfig> {
  const res = await client.get<unknown>("/auth/sso/config/");
  return parseResponse(S.SsoConfig, res, "SSO config");
}

/** Email a password-reset link. The answer is the same whether or not the address has an account. */
export async function requestPasswordReset(client: ApiClient, email: string): Promise<S.PasswordResetResponse> {
  const res = await client.post<unknown>("/auth/password/reset/", { email });
  return parseResponse(S.PasswordResetResponse, res, "password reset response");
}

/** Set a new password from an emailed reset link (ApiError code weak_password, invalid_reset_link, ...). */
export async function confirmPasswordReset(
  client: ApiClient,
  data: S.PasswordResetConfirmRequest
): Promise<S.PasswordResetResponse> {
  const res = await client.post<unknown>("/auth/password/reset/confirm/", data);
  return parseResponse(S.PasswordResetResponse, res, "password reset confirm response");
}

/* ---- user -------------------------------------------------------------- */

export async function fetchUserSelfDetails(client: ApiClient, userId: string | number): Promise<S.User> {
  const res = await client.get<unknown>(`/user/${userId}/`);
  return parseResponse(S.User, res, "user self details");
}

export async function fetchUserList(client: ApiClient): Promise<S.ListUserList> {
  const rows = await fetchAllPages(client, "/user/");
  return parseResponse(S.ListUserList, rows, "user list");
}

/**
 * Change your own user: only the fields in `patch` (a FormData for the avatar upload). Echoing the
 * whole profile back also sends read-only values such as the avatar URL.
 */
export async function updateUserPartial(
  client: ApiClient,
  userId: string | number,
  patch: Record<string, unknown> | FormData
): Promise<S.User> {
  const res = await client.patch<unknown>(`/user/${userId}/`, patch);
  return parseResponse(S.User, res, "update user");
}

/** Admin: change another user (scan directory, name, password, ...). Sends `patch` as it is. */
export async function manageUpdateUser(
  client: ApiClient,
  userId: number,
  patch: Partial<S.ManageUser>
): Promise<S.ManageUser> {
  const res = await client.patch<unknown>(`/manage/user/${userId}/`, patch);
  return parseResponse(S.ManageUser, res, "manage user");
}

/** Admin: delete a user and their library. The server refuses to delete a superuser. Answers 204. */
export async function deleteUser(client: ApiClient, userId: number): Promise<void> {
  await client.delete(`/delete/user/${userId}/`);
}

/* ---- date albums (timeline) ------------------------------------------- */

export type DateAlbumFilter = {
  favorite?: boolean;
  public?: boolean;
  hidden?: boolean;
  /** true: only archived photos (the Archive page); false: none of them (the timeline); absent: both. */
  archived?: boolean;
  in_trashcan?: boolean;
  photo?: boolean;
  video?: boolean;
  is_screenshot?: boolean;
  is_document?: boolean;
  /** The web timeline's filter (api/albums/timeline_filter.py): "all" is the same as leaving it out. */
  media?: "all" | "photos" | "videos";
  hide_screenshots?: boolean;
  hide_documents?: boolean;
  person?: number;
  username?: string;
  folder?: string;
};

/** Map a Photoset onto the backend's boolean date-album filter params. */
export function photosetToFilter(photoset: Photoset): DateAlbumFilter {
  return {
    favorite: photoset === Photoset.FAVORITES || undefined,
    public: photoset === Photoset.PUBLIC || undefined,
    hidden: photoset === Photoset.HIDDEN || undefined,
    archived: photoset === Photoset.ARCHIVED || undefined,
    in_trashcan: photoset === Photoset.IN_TRASHCAN || undefined,
    photo: photoset === Photoset.PHOTOS || undefined,
    video: photoset === Photoset.VIDEOS || undefined,
    is_screenshot: photoset === Photoset.SCREENSHOTS || undefined,
    is_document: photoset === Photoset.DOCUMENTS || undefined,
  };
}

/**
 * The date-album query params: each flag is "true" or left out, and buildQuery drops a blank value.
 * `archived` is the one tri-state flag: "false" leaves archived photos out (the timeline).
 */
function dateAlbumParams(filter: DateAlbumFilter) {
  return {
    favorite: filter.favorite ? "true" : undefined,
    public: filter.public ? "true" : undefined,
    hidden: filter.hidden ? "true" : undefined,
    archived: filter.archived === undefined ? undefined : String(filter.archived),
    in_trashcan: filter.in_trashcan ? "true" : undefined,
    photo: filter.photo ? "true" : undefined,
    video: filter.video ? "true" : undefined,
    is_screenshot: filter.is_screenshot ? "true" : undefined,
    is_document: filter.is_document ? "true" : undefined,
    media: filter.media === "all" ? undefined : filter.media,
    hide_screenshots: filter.hide_screenshots ? "true" : undefined,
    hide_documents: filter.hide_documents ? "true" : undefined,
    person: filter.person,
    username: filter.username?.toLowerCase(),
    folder: filter.folder,
  };
}

export async function fetchDateAlbumsList(
  client: ApiClient,
  filter: DateAlbumFilter = {}
): Promise<S.IncompleteDatePhotosGroup[]> {
  const res = await client.get<unknown>(`/albums/date/list/${buildQuery(dateAlbumParams(filter))}`);
  return parseResponse(S.FetchDateAlbumsListResponse, res, "date albums list").results;
}

export async function fetchDateAlbum(
  client: ApiClient,
  albumDateId: number,
  page: number,
  filter: DateAlbumFilter = {}
): Promise<S.IncompleteDatePhotosGroup> {
  const query = buildQuery({ ...dateAlbumParams(filter), page });
  // Trailing slash: the router 301-redirects without it, one extra round trip per day page.
  const res = await client.get<unknown>(`/albums/date/${albumDateId}/${query}`);
  return parseResponse(S.FetchDateAlbumResponse, res, "date album").results;
}

/* ---- photos ------------------------------------------------------------ */

/** The photos of the latest upload day; with a media filter, of the latest day a matching photo came in. */
export async function fetchRecentlyAddedPhotos(
  client: ApiClient,
  filter: AlbumMediaFilter = {}
): Promise<S.RecentlyAddedPhotosResponse> {
  const res = await client.get<unknown>(`/photos/recentlyadded/${buildQuery(albumMediaQuery(filter))}`);
  return parseResponse(S.RecentlyAddedPhotosResponse, res, "recently added photos");
}

export async function fetchPhotoDetails(client: ApiClient, imageHash: string): Promise<S.Photo> {
  const res = await client.get<unknown>(`/photos/${imageHash}/`);
  return parseResponse(S.Photo, res, "photo details");
}

/** The user albums that hold a photo (the lightbox's Albums section). */
export async function fetchPhotoAlbums(client: ApiClient, imageHash: string): Promise<S.UserAlbumInfo[]> {
  const res = await client.get<unknown>(`/photos/${imageHash}/albums/`);
  return parseResponse(S.FetchUserAlbumsListResponse, res, "photo albums").results;
}

/** A photo's full structured metadata, with its edit history and sidecar files. */
export async function fetchPhotoMetadata(client: ApiClient, photoId: string): Promise<S.PhotoMetadata> {
  const res = await client.get<unknown>(`/photos/${photoId}/metadata`);
  return parseResponse(S.PhotoMetadata, res, "photo metadata");
}

/**
 * Every tag ExifTool reads in a photo's file and its sidecars, read now and never stored (#2277).
 * Owner only: 404 for anyone else, and 404 `file_missing` when the file is gone from disk.
 */
export async function fetchRawPhotoMetadata(client: ApiClient, photoId: string): Promise<S.RawMetadata> {
  const res = await client.get<unknown>(`/photos/${photoId}/metadata/raw/`);
  return parseResponse(S.RawMetadata, res, "raw photo metadata");
}

/** Change a photo's metadata (each change is recorded in its history); answers the new metadata. */
export async function updatePhotoMetadata(
  client: ApiClient,
  photoId: string,
  updates: S.PhotoMetadataUpdate
): Promise<S.PhotoMetadata> {
  const res = await client.patch<unknown>(`/photos/${photoId}/metadata`, updates);
  return parseResponse(S.PhotoMetadata, res, "updated photo metadata");
}

/** Change the same metadata fields on up to 100 photos (by UUID or image hash). */
export async function bulkUpdatePhotoMetadata(
  client: ApiClient,
  photoIds: string[],
  updates: S.PhotoMetadataUpdate
): Promise<S.BulkMetadataUpdateResponse> {
  const res = await client.patch<unknown>("/photos/metadata/bulk", { photo_ids: photoIds, updates });
  return parseResponse(S.BulkMetadataUpdateResponse, res, "bulk metadata update");
}

/**
 * Change fields of one photo (date, location, ...) through PhotoEditSerializer: only the keys in
 * `patch` are sent. See setPhotoTimestamp for the date's format.
 */
export async function updatePhoto(
  client: ApiClient,
  photoId: string,
  patch: Partial<S.Photo>
): Promise<S.PhotoEditResponse> {
  const res = await client.patch<unknown>(`/photos/edit/${photoId}/`, patch);
  return parseResponse(S.PhotoEditResponse, res, "photo update");
}

/**
 * Rotate a photo by `counterClockwiseDegrees` (a multiple of 90) on top of its current rotation,
 * without touching the file. Positive turns the photo left as shown, negative turns it right: a
 * clockwise button sends -90 (#2595).
 */
export async function rotatePhoto(
  client: ApiClient,
  imageHash: string,
  counterClockwiseDegrees: number
): Promise<S.RotatePhotoResponse> {
  const res = await client.post<unknown>("/photosedit/rotate/", {
    image_hash: imageHash,
    angle: counterClockwiseDegrees,
  });
  return parseResponse(S.RotatePhotoResponse, res, "rotate photo");
}

/**
 * Ask the captioning model for a caption of one photo. ApiError 503 `model_downloading` while the
 * model is still being fetched (the server has started the download).
 */
export async function generatePhotoCaption(client: ApiClient, imageHash: string): Promise<S.StatusResponse> {
  const res = await client.post<unknown>("/photosedit/generateim2txt/", { image_hash: imageHash });
  return parseResponse(S.StatusResponse, res, "generate photo caption");
}

/** One photo of a public album, as its sharing settings let a visitor see it. */
export async function fetchPublicAlbumPhoto(
  client: ApiClient,
  slug: string,
  photoId: string
): Promise<S.PublicPhotoDetailResponse> {
  const res = await client.get<unknown>(
    `/public/albums/s/${encodeURIComponent(slug)}/photos/${encodeURIComponent(photoId)}/`
  );
  return parseResponse(S.PublicPhotoDetailResponse, res, "public photo detail");
}

/* ---- photo links (one photo shared by URL, issue #2028) ---------------- */

/** Create (or return the existing), rotate or revoke one photo's public link; answers the link. */
export async function setPhotoShareLink(
  client: ApiClient,
  photoId: string,
  action: S.PhotoShareAction
): Promise<S.PhotoShare> {
  const res = await client.post<unknown>("/photo/share", { photo_id: photoId, action });
  return parseResponse(S.PhotoShareResponse, res, "photo share").share;
}

/** The user's active photo links, newest first. */
export async function fetchPhotoShareLinks(client: ApiClient): Promise<S.PhotoShareLink[]> {
  const res = await client.get<unknown>("/photo/share/list");
  return parseResponse(S.PhotoShareListResponse, res, "photo shares").results;
}

/** A photo shared by link, for a visitor without a session. ApiError 404 for an unknown or revoked link. */
export async function fetchSharedPhoto(client: ApiClient, slug: string): Promise<S.SharedPhoto> {
  const res = await client.get<unknown>(`/public/photo/${encodeURIComponent(slug)}/`);
  return parseResponse(S.SharedPhotoResponse, res, "shared photo").results;
}

/** One page of photos that have no EXIF timestamp (paginated). */
export async function fetchPhotosWithoutTimestamp(
  client: ApiClient,
  page: number,
  filter: AlbumMediaFilter = {}
): Promise<S.PhotosWithoutTimestampResponse> {
  const res = await client.get<unknown>(`/photos/notimestamp/${buildQuery({ page, ...albumMediaQuery(filter) })}`);
  return parseResponse(S.PhotosWithoutTimestampResponse, res, "photos without timestamp");
}

/** One page of photos that have no GPS coordinates (paginated). */
export async function fetchPhotosWithoutLocation(
  client: ApiClient,
  page: number,
  filter: AlbumMediaFilter = {}
): Promise<S.PhotosWithoutLocationResponse> {
  const res = await client.get<unknown>(`/photos/nolocation/${buildQuery({ page, ...albumMediaQuery(filter) })}`);
  return parseResponse(S.PhotosWithoutLocationResponse, res, "photos without location");
}

/** One page of the photos in none of my own albums, newest first (paginated). */
export async function fetchPhotosNotInAlbum(
  client: ApiClient,
  page: number,
  filter: AlbumMediaFilter = {}
): Promise<S.PhotosNotInAlbumResponse> {
  const res = await client.get<unknown>(`/photos/no-album/${buildQuery({ page, ...albumMediaQuery(filter) })}`);
  return parseResponse(S.PhotosNotInAlbumResponse, res, "photos not in an album");
}

/**
 * The first `pageSize` of my own public photos, newest first, and how many there are (`count`).
 * Other users' public photos are not in it.
 */
export async function fetchMyPublicPhotos(client: ApiClient, pageSize: number): Promise<S.MyPublicPhotosResponse> {
  const res = await client.get<unknown>(`/photos/public/${buildQuery({ page_size: pageSize })}`);
  return parseResponse(S.MyPublicPhotosResponse, res, "my public photos");
}

/* ---- albums (user / auto / thing / place) ----------------------------- */

/**
 * The media-type filter (`?photo=true` etc.) that album detail views, search and the Recently added,
 * No timestamp, No location and Not in an album lists accept.
 */
export type AlbumMediaFilter = {
  photo?: boolean;
  video?: boolean;
  is_screenshot?: boolean;
  is_document?: boolean;
};

function albumMediaQuery(filter: AlbumMediaFilter) {
  return {
    photo: filter.photo ? "true" : undefined,
    video: filter.video ? "true" : undefined,
    is_screenshot: filter.is_screenshot ? "true" : undefined,
    is_document: filter.is_document ? "true" : undefined,
  };
}

/**
 * The structured search filters (#2259, #329), all optional and combined with AND. Ranges are
 * inclusive; `taken_after` / `taken_before` are days (`YYYY-MM-DD`); `person` lists people who must
 * all be in the photo. `camera`, `make` and `lens` take a value from `fetchMetadataValues`.
 * A select-all `query` (`BulkPhotoQuery`) takes the same keys, so it acts on what the search listed.
 */
export type SearchFilters = {
  camera?: string;
  make?: string;
  lens?: string;
  iso_min?: number;
  iso_max?: number;
  aperture_min?: number;
  aperture_max?: number;
  focal_min?: number;
  focal_max?: number;
  focal35_min?: number;
  focal35_max?: number;
  /** 1 to 5 stars. */
  rating_min?: number;
  taken_after?: string;
  taken_before?: string;
  /** true: only photos with GPS coordinates; false: only photos without. */
  has_location?: boolean;
  /** image or video: the main file's type; raw: the photo has a RAW file. */
  file_type?: S.FileTypeFilter;
  /** The main file's extension, with or without the dot. */
  extension?: string;
  person?: readonly number[];
};

/** The query parameters of `filter`; unset filters are left out. */
function searchFiltersQuery(filter: SearchFilters) {
  return {
    camera: filter.camera,
    make: filter.make,
    lens: filter.lens,
    iso_min: filter.iso_min,
    iso_max: filter.iso_max,
    aperture_min: filter.aperture_min,
    aperture_max: filter.aperture_max,
    focal_min: filter.focal_min,
    focal_max: filter.focal_max,
    focal35_min: filter.focal35_min,
    focal35_max: filter.focal35_max,
    rating_min: filter.rating_min,
    taken_after: filter.taken_after,
    taken_before: filter.taken_before,
    has_location: filter.has_location,
    file_type: filter.file_type,
    extension: filter.extension,
    person: filter.person,
  };
}

export type UserAlbumOptions = AlbumMediaFilter & {
  /** Read the album through its public link, as `username`'s album. */
  public?: boolean;
  username?: string;
};

export async function fetchUserAlbumsList(client: ApiClient): Promise<S.FetchUserAlbumsListResponse["results"]> {
  const results = await fetchAllPages(client, "/albums/user/list/");
  return parseResponse(S.FetchUserAlbumsListResponse, { results }, "user albums").results;
}

export async function fetchAutoAlbumsList(client: ApiClient): Promise<S.FetchAutoAlbumsListResponse["results"]> {
  const results = await fetchAllPages(client, "/albums/auto/list/");
  return parseResponse(S.FetchAutoAlbumsListResponse, { results }, "auto albums").results;
}

/** Full user-album detail incl. grouped photos (drives membership mirroring). */
export async function fetchUserAlbum(
  client: ApiClient,
  id: number | string,
  options: UserAlbumOptions = {}
): Promise<S.UserAlbum> {
  const query = buildQuery({
    ...albumMediaQuery(options),
    public: options.public ? "true" : undefined,
    username: options.username,
  });
  const res = await client.get<unknown>(`/albums/user/${id}/${query}`);
  return parseResponse(S.UserAlbum, res, "user album detail");
}

/** A public album by its link slug, for a visitor without a session. A 404 is an unknown or expired link. */
export async function fetchPublicAlbum(client: ApiClient, slug: string): Promise<S.PublicAlbum> {
  const res = await client.get<unknown>(`/public/albums/s/${encodeURIComponent(slug)}/`);
  return parseResponse(S.FetchPublicAlbumResponse, res, "public album").results;
}

/** The id of the public album that holds a link slug (the same request, read only for the id). */
export async function fetchPublicAlbumSlugOwner(client: ApiClient, slug: string): Promise<number> {
  const res = await client.get<unknown>(`/public/albums/s/${encodeURIComponent(slug)}/`);
  return parseResponse(S.PublicAlbumSlugOwner, res, "public album slug owner").results.id;
}

/** Full auto-album detail incl. its photos (drives membership mirroring). */
export async function fetchAutoAlbum(client: ApiClient, id: number | string): Promise<S.AutoAlbum> {
  const res = await client.get<unknown>(`/albums/auto/${id}/`);
  return parseResponse(S.AutoAlbum, res, "auto album detail");
}

export async function fetchThingAlbumsList(client: ApiClient): Promise<S.FetchThingAlbumsListResponse["results"]> {
  const results = await fetchAllPages(client, "/albums/thing/list/");
  return parseResponse(S.FetchThingAlbumsListResponse, { results }, "thing albums").results;
}

export async function fetchPlaceAlbumsList(client: ApiClient): Promise<S.FetchPlaceAlbumsListResponse["results"]> {
  const results = await fetchAllPages(client, "/albums/place/list/");
  return parseResponse(S.FetchPlaceAlbumsListResponse, { results }, "place albums").results;
}

export async function fetchTagAlbumsList(client: ApiClient): Promise<S.TagListResponse["results"]> {
  const results = await fetchAllPages(client, "/tags/");
  return parseResponse(S.TagListResponse, { results }, "tag albums").results;
}

/** Photo grid (grouped by date) for one thing album. */
export async function fetchThingAlbum(
  client: ApiClient,
  id: number | string,
  filter: AlbumMediaFilter = {}
): Promise<S.ThingAlbum> {
  const res = await client.get<unknown>(`/albums/thing/${id}/${buildQuery(albumMediaQuery(filter))}`);
  return parseResponse(S.FetchThingAlbumResponse, res, "thing album detail").results;
}

/** Photo grid (grouped by date) for one place album. */
export async function fetchPlaceAlbum(
  client: ApiClient,
  id: number | string,
  filter: AlbumMediaFilter = {}
): Promise<S.PlaceAlbum> {
  const res = await client.get<unknown>(`/albums/place/${id}/${buildQuery(albumMediaQuery(filter))}`);
  return parseResponse(S.FetchPlaceAlbumResponse, res, "place album detail").results;
}

/** Every geocoded place as `[lat, lon, name]`, for the Places map. */
export async function fetchLocationClusters(client: ApiClient): Promise<S.LocationClusters> {
  const res = await client.get<unknown>("/locclust/");
  return parseResponse(S.LocationClusters, res, "location clusters");
}

/**
 * One page (100 directory entries) of a folder's subfolders; without `path`, of the user's scan
 * directory. ApiError 403 for a folder outside it.
 */
export async function fetchFolderSubfolders(
  client: ApiClient,
  options: { path?: string; page?: number } = {}
): Promise<S.FolderSubfoldersResponse> {
  const query = buildQuery({ path: options.path, page: options.page });
  const res = await client.get<unknown>(`/folders/subfolders/${query}`);
  return parseResponse(S.FolderSubfoldersResponse, res, "folder subfolders");
}

/**
 * Every subfolder of a folder (all pages, following `next`), with the folder's own paths from the
 * first page; without `path`, of the user's scan directory. ApiError 403 for a folder outside it.
 */
export async function fetchAllFolderSubfolders(
  client: ApiClient,
  options: { path?: string } = {}
): Promise<S.FolderSubfolderListing> {
  const { first, rows } = await fetchAllPagesWithFirst(
    client,
    `/folders/subfolders/${buildQuery({ path: options.path })}`
  );
  const { current_path, parent_path } = parseResponse(S.FolderSubfoldersResponse, first, "folder subfolders");
  const results = parseResponse(S.FolderSubfolder.array(), rows, "folder subfolders");
  return { current_path, parent_path, results };
}

/** Photo grid (grouped by date) for one tag album. */
export async function fetchTagAlbum(
  client: ApiClient,
  id: number | string,
  filter: AlbumMediaFilter = {}
): Promise<S.TagAlbum> {
  const res = await client.get<unknown>(`/tags/${id}/${buildQuery(albumMediaQuery(filter))}`);
  return parseResponse(S.TagAlbumResponse, res, "tag album detail").results;
}

/* ---- tags -------------------------------------------------------------- */

/** The tags on one photo (by photo id or image hash), all pages. */
export async function fetchPhotoTags(client: ApiClient, photoId: string): Promise<S.TagList> {
  const results = await fetchAllPages(client, `/tags/${buildQuery({ photo: photoId })}`);
  return parseResponse(S.TagListResponse, { results }, "photo tags").results;
}

/** Create a tag. When the user already has one by that name, the server answers that tag. */
export async function createTag(client: ApiClient, name: string): Promise<S.Tag> {
  const res = await client.post<unknown>("/tags/", { name });
  return parseResponse(S.Tag, res, "create tag");
}

/** Rename a tag. */
export async function renameTag(client: ApiClient, tagId: number | string, name: string): Promise<S.Tag> {
  const res = await client.patch<unknown>(`/tags/${tagId}/`, { name });
  return parseResponse(S.Tag, res, "rename tag");
}

/** Delete a tag; its photos stay. Answers 204. */
export async function deleteTag(client: ApiClient, tagId: number | string): Promise<void> {
  await client.delete(`/tags/${tagId}/`);
}

/** Merge the tag `sourceTagId` into `tagId`: its photos move over and it is deleted. */
export async function mergeTags(client: ApiClient, tagId: number | string, sourceTagId: number): Promise<S.Tag> {
  const res = await client.post<unknown>(`/tags/${tagId}/merge/`, { tag: sourceTagId });
  return parseResponse(S.Tag, res, "merge tags");
}

/**
 * Which photos a tag edit applies to: the ids or hashes (`photos`), or with `selectAll` the query
 * and its exclusions (an unset query is `{}`, unset exclusions `[]`).
 */
function tagPhotosBody(photos: string[], selectAll: SelectAllPhotos | undefined) {
  if (!selectAll) return { photos };
  return { select_all: true, query: selectAll.query ?? {}, excluded_hashes: selectAll.excludedHashes ?? [] };
}

/** Tag photos (by photo id or image hash, or a selected-all set). Answers the tag. */
export async function addPhotosToTag(
  client: ApiClient,
  tagId: number | string,
  photos: string[],
  selectAll?: SelectAllPhotos
): Promise<S.Tag> {
  const res = await client.post<unknown>(`/tags/${tagId}/add/`, tagPhotosBody(photos, selectAll));
  return parseResponse(S.Tag, res, "add photos to tag");
}

/** Take a tag off photos (by photo id or image hash). Answers the tag. */
export async function removePhotosFromTag(client: ApiClient, tagId: number | string, photos: string[]): Promise<S.Tag> {
  const res = await client.post<unknown>(`/tags/${tagId}/remove/`, { photos });
  return parseResponse(S.Tag, res, "remove photos from tag");
}

/* ---- persons ----------------------------------------------------------- */

/** Every person, all pages; `pageSize` asks for bigger pages (the server allows up to 1000). */
export async function fetchPeopleAlbums(client: ApiClient, options: { pageSize?: number } = {}): Promise<S.PersonList> {
  const results = await fetchAllPages(client, `/persons/${buildQuery({ page_size: options.pageSize })}`);
  return parseResponse(S.FetchPeopleAlbumsResponse, { results }, "people albums").results;
}

/** One person: the person page's title (ApiError 404 for an unknown id or another user's person). */
export async function fetchPerson(client: ApiClient, personId: number | string): Promise<S.Person> {
  const res = await client.get<unknown>(`/persons/${personId}/`);
  return parseResponse(S.Person, res, "person");
}

/** Take a person off photos (by `Photo.id`): their faces on them go back to unknown. */
export async function removePhotosFromPerson(
  client: ApiClient,
  personId: number | string,
  photoIds: string[]
): Promise<S.PersonRemovePhotosResponse> {
  const res = await client.post<unknown>(`/persons/${personId}/remove-photos/`, { photo_ids: photoIds });
  return parseResponse(S.PersonRemovePhotosResponse, res, "remove photos from person");
}

/** Merge `sourceId` into `targetId`: its faces move over, the target keeps its name and cover, and the source is deleted. */
export async function mergePerson(
  client: ApiClient,
  targetId: number | string,
  sourceId: number | string
): Promise<S.PersonMergeResponse> {
  const res = await client.post<unknown>(`/persons/${targetId}/merge/`, { person: Number(sourceId) });
  return parseResponse(S.PersonMergeResponse, res, "merge person");
}

/** Rename a person. */
export async function renamePerson(
  client: ApiClient,
  personId: number | string,
  newPersonName: string
): Promise<S.PersonEditResponse> {
  const res = await client.patch<unknown>(`/persons/${personId}/`, { newPersonName });
  return parseResponse(S.PersonEditResponse, res, "rename person");
}

/** Set a person's cover photo. */
export async function setPersonCover(
  client: ApiClient,
  personId: number | string,
  coverPhoto: string
): Promise<S.PersonEditResponse> {
  const res = await client.patch<unknown>(`/persons/${personId}/`, { cover_photo: coverPhoto });
  return parseResponse(S.PersonEditResponse, res, "set person cover");
}

/** Delete a person. Answers 204. */
export async function deletePerson(client: ApiClient, personId: number | string): Promise<void> {
  await client.delete(`/persons/${personId}/`);
}

/* ---- person groups (#1126) --------------------------------------------- */

/** The user's groups of people by name, each with its person count; all pages. */
export async function fetchPersonGroups(client: ApiClient): Promise<S.PersonGroup[]> {
  const results = await fetchAllPages(client, "/person-groups/");
  return parseResponse(S.PersonGroupList, { results }, "person groups").results;
}

/** Create a group (ApiError 400 `unique` when the user has one of that name in any case). */
export async function createPersonGroup(client: ApiClient, name: string): Promise<S.PersonGroup> {
  const res = await client.post<unknown>("/person-groups/", { name });
  return parseResponse(S.PersonGroup, res, "create person group");
}

/** Rename a group; its people stay in it. */
export async function renamePersonGroup(client: ApiClient, groupId: number, name: string): Promise<S.PersonGroup> {
  const res = await client.patch<unknown>(`/person-groups/${groupId}/`, { name });
  return parseResponse(S.PersonGroup, res, "rename person group");
}

/** Delete a group; its people stay. Answers 204. */
export async function deletePersonGroup(client: ApiClient, groupId: number): Promise<void> {
  await client.delete(`/person-groups/${groupId}/`);
}

/** Put a person in exactly these groups of the user's; answers the ids they are in now. */
export async function setPersonGroups(
  client: ApiClient,
  personId: number | string,
  groupIds: readonly number[]
): Promise<S.PersonGroupsResponse> {
  const res = await client.request<unknown>(`/persons/${personId}/groups/`, {
    method: "PUT",
    body: { group_ids: groupIds },
  });
  return parseResponse(S.PersonGroupsResponse, res, "set person groups");
}

/* ---- search ------------------------------------------------------------ */

/**
 * Search the library. The server picks the answer's shape from the user's semantic_search_topk:
 * `semantic` says which one to read (a flat list, or date groups). `filter` narrows it to photos,
 * videos or screenshots, and by the structured search filters (`SearchFilters`); with filters the
 * term may be empty.
 */
export async function searchPhotos(
  client: ApiClient,
  searchTerm: string,
  semantic = false,
  filter: AlbumMediaFilter & SearchFilters = {}
): Promise<S.SearchPhotosResult> {
  const query = buildQuery({ search: searchTerm, ...albumMediaQuery(filter), ...searchFiltersQuery(filter) });
  const res = await client.get<unknown>(`/photos/searchlist/${query}`);
  if (semantic) {
    const parsed = parseResponse(S.SemanticSearchPhotos, res, "semantic search photos");
    return { photosFlat: parsed.results, photosGroupedByDate: [] };
  }
  const parsed = parseResponse(S.SearchPhotos, res, "search photos");
  return {
    photosFlat: parsed.results.flatMap(group => group.items),
    photosGroupedByDate: parsed.results,
  };
}

/** The cameras, makers or lenses of my photos, most photos first: the suggestions of the search filters. */
export async function fetchMetadataValues(
  client: ApiClient,
  field: S.MetadataValueField
): Promise<S.MetadataValuesResponse["results"]> {
  const res = await client.get<unknown>(`/search/metadata-values/${buildQuery({ field })}`);
  return parseResponse(S.MetadataValuesResponse, res, "metadata values").results;
}

/** A few example searches built from the user's library (captions, people, places). */
export async function fetchSearchExamples(client: ApiClient): Promise<S.SearchExamples> {
  const res = await client.get<unknown>("/searchtermexamples/");
  return parseResponse(S.SearchExamplesResponse, res, "search examples").results;
}

/* ---- settings ---------------------------------------------------------- */

export async function fetchSiteSettings(client: ApiClient): Promise<S.SiteSettings> {
  const res = await client.get<unknown>("/sitesettings");
  return parseResponse(S.SiteSettings, res, "site settings");
}

/** Admin: change site settings (only the keys sent); answers the settings as GET does. */
export async function updateSiteSettings(client: ApiClient, settings: S.SiteSettingsUpdate): Promise<S.SiteSettings> {
  const res = await client.post<unknown>("/sitesettings", settings);
  return parseResponse(S.SiteSettings, res, "update site settings");
}

/** Admin: how many photos, of how many users, a trash retention of `days` deletes at the next cleanup. */
export async function fetchTrashRetentionPreview(client: ApiClient, days: number): Promise<S.TrashRetentionPreview> {
  const res = await client.get<unknown>(`/sitesettings/trash-retention-preview/${buildQuery({ days })}`);
  return parseResponse(S.TrashRetentionPreview, res, "trash retention preview");
}

/** A few views answer a JSON document as a JSON string (json.dumps, then Response): decode it. */
function decodeJsonString(res: unknown, context: string): unknown {
  return JSON.parse(parseResponse(z.string(), res, context));
}

/** Every time zone name. The view sends the list as a JSON string; a body that is no JSON throws a SyntaxError. */
export async function fetchTimezones(client: ApiClient): Promise<S.Timezones> {
  const res = await client.get<unknown>("/timezones/");
  return parseResponse(S.Timezones, decodeJsonString(res, "timezones"), "timezones");
}

/**
 * The predefined date-time rules, parsed rule by rule: a rule type a newer backend added is
 * skipped (and listed in `skipped`), and the rest still work.
 */
export async function fetchPredefinedRules(client: ApiClient): Promise<ParsedEntries<S.DateTimeRule>> {
  const res = await client.get<unknown>("/predefinedrules/");
  const context = "predefined date-time rules";
  return parseEachResponse(S.DateTimeRule, decodeJsonString(res, context), context);
}

/** The predefined burst detection rules, parsed rule by rule (see fetchPredefinedRules). */
export async function fetchPredefinedBurstRules(client: ApiClient): Promise<ParsedEntries<S.BurstDetectionRule>> {
  const res = await client.get<unknown>("/predefinedburstrules/");
  const context = "predefined burst rules";
  return parseEachResponse(S.BurstDetectionRule, decodeJsonString(res, context), context);
}

/** Admin: the instance email setup. */
export async function fetchEmailConfig(client: ApiClient): Promise<S.EmailConfig> {
  const res = await client.get<unknown>("/email-config/");
  return parseResponse(S.EmailConfig, res, "email configuration");
}

/** Admin: change the email setup (only the fields sent); answers the new setup. */
export async function updateEmailConfig(client: ApiClient, config: S.EmailConfigUpdate): Promise<S.EmailConfig> {
  const res = await client.post<unknown>("/email-config/", config);
  return parseResponse(S.EmailConfig, res, "email configuration response");
}

/** Admin: send a test email, to `to` or else to the admin's own address. */
export async function sendTestEmail(client: ApiClient, to?: string): Promise<S.EmailTestResponse> {
  const res = await client.post<unknown>("/email-config/test/", to ? { to } : {});
  return parseResponse(S.EmailTestResponse, res, "test-email response");
}

/* ---- jobs -------------------------------------------------------------- */

/** One page of jobs. Staff see everyone's unless `mine` narrows the list to their own. */
export async function fetchJobs(
  client: ApiClient,
  page = 1,
  pageSize = 20,
  options: { mine?: boolean } = {}
): Promise<S.JobsResponse> {
  const query = buildQuery({ page, page_size: pageSize, mine: options.mine ? "true" : undefined });
  const res = await client.get<unknown>(`/jobs/${query}`);
  return parseResponse(S.JobsResponse, res, "jobs");
}

/** One job, with its progress. */
export async function fetchJob(client: ApiClient, jobId: number): Promise<S.JobDetail> {
  const res = await client.get<unknown>(`/jobs/${jobId}/`);
  return parseResponse(S.JobDetail, res, "job");
}

/** Cancel a queued or running job (ApiError code job_finished when it has finished). */
export async function cancelJob(client: ApiClient, jobId: number): Promise<S.CancelJobResponse> {
  const res = await client.post<unknown>(`/jobs/${jobId}/cancel/`, {});
  return parseResponse(S.CancelJobResponse, res, "cancel job");
}

/** Delete a job from the list. Answers 204. */
export async function deleteJob(client: ApiClient, jobId: number): Promise<void> {
  await client.delete(`/jobs/${jobId}/`);
}

export async function fetchWorkerAvailability(client: ApiClient): Promise<S.WorkerAvailabilityResponse> {
  const res = await client.get<unknown>("/rqavailable/");
  return parseResponse(S.WorkerAvailabilityResponse, res, "worker availability");
}

/**
 * Start a job. When one of its kind is already queued or running (409
 * `job_already_running`) this resolves with that job, `already_running: true`,
 * instead of rejecting: the caller follows it rather than reporting an error.
 */
async function triggerJob<T>(
  client: ApiClient,
  endpoint: string,
  schema: z.ZodType<T>,
  context: string,
  body: object = {}
): Promise<T | S.JobAlreadyRunning> {
  try {
    const res = await client.post<unknown>(endpoint, body);
    return parseResponse(schema, res, context);
  } catch (error) {
    const jobId = runningJobId(error);
    if (jobId === null) throw error;
    return { status: true, job_id: jobId, already_running: true };
  }
}

/** Trigger an incremental library scan. Returns the queued (or already running) job id. */
export async function scanPhotos(client: ApiClient): Promise<S.JobTriggerResponse> {
  return triggerJob(client, "/scanphotos/", S.JobTriggerResponse, "scan photos");
}

/** Trigger a full library rescan. */
export async function fullScanPhotos(client: ApiClient): Promise<S.JobTriggerResponse> {
  return triggerJob(client, "/fullscanphotos/", S.JobTriggerResponse, "full scan photos");
}

/** Start the job that removes the photos whose files are gone. */
export async function deleteMissingPhotos(client: ApiClient): Promise<S.JobTriggerResponse> {
  return triggerJob(client, "/deletemissingphotos", S.JobTriggerResponse, "delete missing photos");
}

/** Scan the user's Nextcloud folder. */
export async function scanNextcloudPhotos(client: ApiClient): Promise<S.JobTriggerResponse> {
  return triggerJob(client, "/nextcloud/scanphotos/", S.JobTriggerResponse, "scan Nextcloud photos");
}

/** Run text recognition: on the photos without a result yet, or with `fullScan` on every photo. */
export async function generateOcr(client: ApiClient, fullScan: boolean): Promise<S.JobTriggerResponse> {
  return triggerJob(client, "/generateocr/", S.JobTriggerResponse, "generate OCR", { full_scan: fullScan });
}

/**
 * Caption the signed-in user's photos (#2211): the ones without a generated caption, or with
 * `fullScan` every photo. Captions the user wrote are never replaced. A 403 while captioning is
 * off on the server. `downloads_model` says the job waits for the captioning model's download.
 */
export async function generateCaptions(
  client: ApiClient,
  fullScan: boolean
): Promise<S.CaptionsJobStartedResponse | S.JobAlreadyRunning> {
  return triggerJob(client, "/generate-captions/", S.CaptionsJobStartedResponse, "generate captions", {
    full_scan: fullScan,
  });
}

/**
 * Remove photo details (EXIF, GPS, XMP) from the thumbnails older releases wrote, over the whole
 * instance (admins only, #2321). Returns the queued (or already running) job.
 */
export async function stripThumbnailMetadata(client: ApiClient): Promise<S.JobStartedResponse | S.JobAlreadyRunning> {
  return triggerJob(client, "/strip-thumbnail-metadata/", S.JobStartedResponse, "strip thumbnail metadata");
}

/** The post-upgrade tasks this instance still has, and those done in the last day (admins only, #2322). */
export async function fetchUpgradeTasks(client: ApiClient): Promise<S.UpgradeTaskList> {
  const res = await client.get<unknown>("/upgrade-tasks/");
  return parseResponse(S.UpgradeTaskList, res, "upgrade tasks");
}

/**
 * Start (or retry) a post-upgrade task (admins only, #2322). While another job is queued or
 * running the server refuses with 409 `queue_busy`; its own job running resolves as that job.
 */
export async function startUpgradeTask(
  client: ApiClient,
  key: string
): Promise<S.JobStartedResponse | S.JobAlreadyRunning> {
  return triggerJob(client, `/upgrade-tasks/${encodeURIComponent(key)}/start/`, S.JobStartedResponse, "upgrade task");
}

/** Not now: hide an optional post-upgrade task for good (400 `task_required` for a required one). */
export async function dismissUpgradeTask(client: ApiClient, key: string): Promise<S.UpgradeTaskList> {
  const res = await client.post<unknown>(`/upgrade-tasks/${encodeURIComponent(key)}/dismiss/`, {});
  return parseResponse(S.UpgradeTaskList, res, "dismiss upgrade task");
}

/**
 * Look the place names of every photo up again with the current Map Provider, over the whole
 * instance (admins only, #2302). Returns the queued (or already running) job.
 */
export async function lookUpPlaces(client: ApiClient): Promise<S.JobStartedResponse | S.JobAlreadyRunning> {
  return triggerJob(client, "/look-up-places/", S.JobStartedResponse, "look up place names");
}

/**
 * Permanently delete every photo in the signed-in user's trash, files included, as a job (#2203).
 * Returns the queued (or already running) job.
 */
export async function emptyTrash(client: ApiClient): Promise<S.JobStartedResponse | S.JobAlreadyRunning> {
  return triggerJob(client, "/photosedit/empty-trash/", S.JobStartedResponse, "empty trash");
}

/**
 * Read the date of the signed-in user's photos again with their current date rules (#437). A date
 * set by hand stays and nothing is written to the files. Returns the queued (or already running) job.
 */
export async function reapplyDateRules(client: ApiClient): Promise<S.JobStartedResponse | S.JobAlreadyRunning> {
  return triggerJob(client, "/photos/reapply-date-rules/", S.JobStartedResponse, "apply date rules");
}

/**
 * What "Write metadata to files" (#2287) would write for the signed-in user now: where (the saved
 * "Write edits to files"), and how many photos each type writes.
 */
export async function fetchWriteMetadataPreview(client: ApiClient): Promise<S.WriteMetadataPreview> {
  const res = await client.get<unknown>("/savemetadata/");
  return parseResponse(S.WriteMetadataPreview, res, "write metadata preview");
}

/**
 * Write the edits already in LibrePhotos to the signed-in user's files, as a job (#2287): `types`, or
 * everything their settings write. Returns the queued (or already running) job.
 */
export async function writeMetadataToFiles(
  client: ApiClient,
  types?: readonly string[]
): Promise<S.WriteMetadataStarted | S.JobAlreadyRunning> {
  return triggerJob(
    client,
    "/savemetadata/",
    S.WriteMetadataStarted,
    "write metadata to files",
    types ? { types } : {}
  );
}

/**
 * Read the files of some of the signed-in user's photos again (#2214), also unchanged ones: their
 * thumbnails, metadata, date and hashes. At most 1,000 photos. ApiError 404 when none is the
 * user's, 400 (`no_files_to_scan`) when none has a file left in their library.
 */
export async function rescanPhotos(
  client: ApiClient,
  photoIds: readonly string[]
): Promise<S.RescanPhotosResponse | S.JobAlreadyRunning> {
  return triggerJob(client, "/photos/rescan/", S.RescanPhotosResponse, "rescan photos", { photo_ids: photoIds });
}

/**
 * Scan files an outside process says are new or changed (#900): paths as the server sees them,
 * at most 1,000. Only files in the user's library are scanned; the answer lists the paths left out.
 */
export async function scanFiles(
  client: ApiClient,
  paths: readonly string[]
): Promise<S.ScanFilesResponse | S.JobAlreadyRunning> {
  return triggerJob(client, "/scan-files/", S.ScanFilesResponse, "scan files", { paths });
}

/** Make event albums from the photos added or changed since the last run, and title them. */
export async function generateEventAlbums(client: ApiClient): Promise<S.JobTriggerResponse> {
  return triggerJob(client, "/autoalbumgen/", S.JobTriggerResponse, "generate event albums");
}

/** Re-title every event album (generateEventAlbums only titles the albums whose photos changed). */
export async function regenerateEventAlbumTitles(client: ApiClient): Promise<S.JobTriggerResponse> {
  return triggerJob(client, "/autoalbumtitlegen/", S.JobTriggerResponse, "regenerate event album titles");
}

/* ---- zip downloads ------------------------------------------------------ */

/**
 * Start the job that zips photos (by hash, or a selected-all set; with `includeStackedPhotos`
 * the other photos of their stacks too). Follow it with fetchPhotoDownloadStatus, fetch the
 * archive by its file name (`url`) from the media route, then deletePhotoDownload.
 */
export async function startPhotoDownload(
  client: ApiClient,
  imageHashes: string[],
  options: { selectAll?: SelectAllPhotos; includeStackedPhotos?: boolean } = {}
): Promise<S.PhotoDownloadStart> {
  const res = await client.post<unknown>("/photos/download", {
    ...photoSelection(imageHashes, options.selectAll),
    include_stacked_photos: options.includeStackedPhotos ?? false,
  });
  return parseResponse(S.PhotoDownloadStart, res, "start photo download");
}

/** Where a zip download's job is: PENDING, SUCCESS or FAILURE. */
export async function fetchPhotoDownloadStatus(client: ApiClient, jobId: string): Promise<S.PhotoDownloadStatus> {
  const res = await client.get<unknown>(`/photos/download${buildQuery({ job_id: jobId })}`);
  return parseResponse(S.PhotoDownloadStatus, res, "photo download status");
}

/** Delete a zip download's archive once it has been saved. */
export async function deletePhotoDownload(client: ApiClient, fileName: string): Promise<void> {
  await client.delete(`/delete/zip/${fileName}`);
}

/* ---- stacks (bursts, brackets, manual groups) ---------------------------- */

export type StackListParams = {
  page?: number;
  pageSize?: number;
  stackType?: string;
  ordering?: string;
};

/** One page of stacks (only those with at least two photos), newest first. */
export async function fetchStacks(client: ApiClient, params: StackListParams = {}): Promise<S.PhotoStackListResponse> {
  const query = buildQuery({
    page: params.page || undefined,
    page_size: params.pageSize || undefined,
    stack_type: params.stackType,
    ordering: params.ordering,
  });
  const res = await client.get<unknown>(`/stacks${query}`);
  return parseResponse(S.PhotoStackListResponse, res, "stacks list");
}

/** One stack with all its photos. */
export async function fetchStack(client: ApiClient, stackId: string): Promise<S.PhotoStack> {
  const res = await client.get<unknown>(`/stacks/${stackId}/`);
  return parseResponse(S.PhotoStack, res, "stack details");
}

export async function fetchStackStats(client: ApiClient): Promise<S.PhotoStackStats> {
  const res = await client.get<unknown>("/stacks/stats/");
  return parseResponse(S.PhotoStackStats, res, "stack stats");
}

/** Take photos out of a stack; a stack left with fewer than two photos is deleted. */
export async function removePhotosFromStack(
  client: ApiClient,
  stackId: string,
  photoHashes: string[]
): Promise<S.RemoveFromStackResponse> {
  const res = await client.post<unknown>(`/stacks/${stackId}/remove/`, { photo_hashes: photoHashes });
  return parseResponse(S.RemoveFromStackResponse, res, "remove from stack");
}

/** Merge every manual stack that holds one of the photos into one. */
export async function mergeStacks(client: ApiClient, photoHashes: string[]): Promise<S.MergeStacksResponse> {
  const res = await client.post<unknown>("/stacks/merge/", { photo_hashes: photoHashes });
  return parseResponse(S.MergeStacksResponse, res, "merge stacks");
}

/** Put photos (at least two) in a manual stack: the one a photo is already in, or a new one. */
export async function createManualStack(
  client: ApiClient,
  photoHashes: string[]
): Promise<S.CreateManualStackResponse> {
  const res = await client.post<unknown>("/stacks/manual/", { photo_hashes: photoHashes });
  return parseResponse(S.CreateManualStackResponse, res, "create manual stack");
}

/** Delete a stack; its photos stay. */
export async function deleteStack(client: ApiClient, stackId: string): Promise<S.UnlinkGroupResponse> {
  const res = await client.delete<unknown>(`/stacks/${stackId}/`);
  return parseResponse(S.UnlinkGroupResponse, res, "delete stack");
}

/** Make one of a stack's photos its cover. */
export async function setStackPrimary(
  client: ApiClient,
  stackId: string,
  photoHash: string
): Promise<S.SetStackPrimaryResponse> {
  const res = await client.post<unknown>(`/stacks/${stackId}/primary/`, { photo_hash: photoHash });
  return parseResponse(S.SetStackPrimaryResponse, res, "set stack cover");
}

/** Start stack detection (bursts, by the user's burst rules). */
export async function detectStacks(
  client: ApiClient,
  options: S.DetectStacksRequest = {}
): Promise<S.DetectionQueuedResponse | S.JobAlreadyRunning> {
  return triggerJob(client, "/stacks/detect/", S.DetectionQueuedResponse, "detect stacks", options);
}

/* ---- duplicates (exact copies, visual duplicates) ----------------------- */

export type DuplicateListParams = {
  duplicateType?: S.DuplicateType;
  status?: S.ReviewStatus;
  page?: number;
  pageSize?: number;
};

/** One page of duplicate groups (only those with at least two photos), newest first. */
export async function fetchDuplicates(
  client: ApiClient,
  params: DuplicateListParams = {}
): Promise<S.DuplicateListResponse> {
  const query = buildQuery({
    duplicate_type: params.duplicateType,
    status: params.status,
    page: params.page ?? 1,
    page_size: params.pageSize ?? 20,
  });
  const res = await client.get<unknown>(`/duplicates${query}`);
  return parseResponse(S.DuplicateListResponse, res, "duplicates list");
}

/** One duplicate group with all its photos and the one the server suggests keeping. */
export async function fetchDuplicate(client: ApiClient, duplicateId: string): Promise<S.DuplicateDetail> {
  const res = await client.get<unknown>(`/duplicates/${duplicateId}`);
  return parseResponse(S.DuplicateDetail, res, "duplicate details");
}

export async function fetchDuplicateStats(client: ApiClient): Promise<S.DuplicateStats> {
  const res = await client.get<unknown>("/duplicates/stats");
  return parseResponse(S.DuplicateStats, res, "duplicate stats");
}

/** Keep one photo of a group, and with `trashOthers` move the others to the trash. */
export async function resolveDuplicate(
  client: ApiClient,
  duplicateId: string,
  keepPhotoHash: string,
  trashOthers: boolean
): Promise<S.ResolveDuplicateResponse> {
  const res = await client.post<unknown>(`/duplicates/${duplicateId}/resolve`, {
    keep_photo_hash: keepPhotoHash,
    trash_others: trashOthers,
  });
  return parseResponse(S.ResolveDuplicateResponse, res, "resolve duplicate");
}

/** Mark a group as not duplicates. */
export async function dismissDuplicate(client: ApiClient, duplicateId: string): Promise<S.DismissDuplicateResponse> {
  const res = await client.post<unknown>(`/duplicates/${duplicateId}/dismiss`, {});
  return parseResponse(S.DismissDuplicateResponse, res, "dismiss duplicate");
}

/** Undo a resolved group: its trashed photos come back and it is pending again. */
export async function revertDuplicate(client: ApiClient, duplicateId: string): Promise<S.RevertDuplicateResponse> {
  const res = await client.post<unknown>(`/duplicates/${duplicateId}/revert`, {});
  return parseResponse(S.RevertDuplicateResponse, res, "revert duplicate");
}

/** Delete a duplicate group; its photos stay. */
export async function deleteDuplicate(client: ApiClient, duplicateId: string): Promise<S.UnlinkGroupResponse> {
  const res = await client.delete<unknown>(`/duplicates/${duplicateId}/delete`);
  return parseResponse(S.UnlinkGroupResponse, res, "delete duplicate");
}

/** Start duplicate detection (unset options take the server's defaults). */
export async function detectDuplicates(
  client: ApiClient,
  options: S.DetectDuplicatesRequest = {}
): Promise<S.DetectionQueuedResponse | S.JobAlreadyRunning> {
  return triggerJob(client, "/duplicates/detect", S.DetectionQueuedResponse, "detect duplicates", options);
}

/* ---- sharing ----------------------------------------------------------- */

export async function fetchSharedPhotosByMe(client: ApiClient): Promise<S.SharedPhotosResponse["results"]> {
  const results = await fetchAllPages(client, "/photos/shared/fromme/");
  return parseResponse(S.SharedPhotosResponse, { results }, "shared photos by me").results;
}

export async function fetchSharedPhotosWithMe(client: ApiClient): Promise<S.SharedToMePhotosResponse["results"]> {
  const results = await fetchAllPages(client, "/photos/shared/tome/");
  return parseResponse(S.SharedToMePhotosResponse, { results }, "shared photos with me").results;
}

export async function fetchSharedAlbumsByMe(client: ApiClient): Promise<S.SharedAlbumsResponse["results"]> {
  const results = await fetchAllPages(client, "/albums/user/shared/fromme/");
  return parseResponse(S.SharedAlbumsResponse, { results }, "shared albums by me").results;
}

export async function fetchSharedAlbumsWithMe(client: ApiClient): Promise<S.SharedAlbumsResponse["results"]> {
  const results = await fetchAllPages(client, "/albums/user/shared/tome/");
  return parseResponse(S.SharedAlbumsResponse, { results }, "shared albums with me").results;
}

/** Share (or unshare) photos to another user, by hash or selected-all; `count` is the photos changed. */
export async function setPhotosShared(
  client: ApiClient,
  imageHashes: string[],
  targetUserId: number,
  shared: boolean,
  selectAll?: SelectAllPhotos
): Promise<S.BulkPhotoMutationResponse> {
  const res = await client.post<unknown>("/photosedit/share/", {
    ...photoSelection(imageHashes, selectAll),
    val_shared: shared,
    target_user_id: targetUserId,
  });
  return parseResponse(S.BulkPhotoMutationResponse, res, "share photos");
}

/** Share (or unshare) a user album to another user; answers the album's card. */
export async function setUserAlbumShared(
  client: ApiClient,
  albumId: number | string,
  targetUserId: number | string,
  shared: boolean
): Promise<S.UserAlbumInfo> {
  const res = await client.post<unknown>("/useralbum/share/", {
    album_id: String(albumId),
    target_user_id: String(targetUserId),
    shared,
  });
  return parseResponse(S.UserAlbumInfo, res, "share user album");
}

/**
 * Leave an album someone shared with you: it drops off your "Shared with me" list, while the
 * owner and the other recipients keep it. Answers 204; 404 for an album not shared with you.
 */
export async function leaveSharedAlbum(client: ApiClient, albumId: number | string): Promise<void> {
  await client.post("/useralbum/leave/", { album_id: String(albumId) });
}

/* ---- public links ------------------------------------------------------ */

/** Make photos (by hash or selected-all) public, so they show in the owner's public gallery, or private. */
export async function setPhotosPublic(
  client: ApiClient,
  imageHashes: string[],
  isPublic: boolean,
  selectAll?: SelectAllPhotos
): Promise<S.BulkPhotoMutationResponse> {
  const res = await client.post<unknown>("/photosedit/makepublic/", {
    ...photoSelection(imageHashes, selectAll),
    val_public: isPublic,
  });
  return parseResponse(S.BulkPhotoMutationResponse, res, "make photos public");
}

/** Toggle a user album's public link (optionally with slug, expiry and per-album sharing options). */
export async function setUserAlbumPublic(
  client: ApiClient,
  args: {
    albumId: number | string;
    isPublic: boolean;
    slug?: string;
    expiresAt?: string | null;
    sharingOptions?: S.PublicSharingOptions;
  }
): Promise<S.SetUserAlbumPublicResponse> {
  const res = await client.post<unknown>("/useralbum/makepublic", {
    album_id: String(args.albumId),
    val_public: args.isPublic,
    slug: args.slug,
    expires_at: args.expiresAt,
    sharing_options: args.sharingOptions,
  });
  return parseResponse(S.SetUserAlbumPublicResponse, res, "make user album public");
}

/* ---- faces ------------------------------------------------------------- */

export type FaceListParams = {
  /** Person id; 0 (default) means unknown/other faces. */
  person?: number;
  /** 0-based page index (frontend convention). */
  page?: number;
  inferred?: boolean;
  orderBy?: S.FaceOrderBy;
  analysisMethod?: S.FaceAnalysisMethod;
  minConfidence?: number;
  /** The person's deleted faces instead (#127); the method and threshold do not apply. */
  deleted?: boolean;
};

export async function fetchFaces(client: ApiClient, params: FaceListParams = {}): Promise<S.PersonFaceListResponse> {
  const query = buildQuery({
    person: params.person ?? 0,
    page: params.page ?? 1,
    inferred: params.inferred ?? false,
    order_by: params.orderBy ?? "confidence",
    analysis_method: params.analysisMethod,
    min_confidence: params.minConfidence,
    deleted: params.deleted || undefined,
  });
  const res = await client.get<unknown>(`/faces/${query}`);
  return parseResponse(S.PersonFaceListResponse, res, "faces");
}

/**
 * Every person with a face count, plus an "Unknown - Other" entry (id 0) for the faces of no one.
 * With `inferred`, the counts take in the suggested faces too (above `minConfidence`). With
 * `deleted`, they count each person's deleted faces instead (#127). `group`
 * narrows the people to one of the user's groups (#1126).
 */
export async function fetchIncompleteFaces(
  client: ApiClient,
  params: {
    inferred?: boolean;
    orderBy?: S.FaceOrderBy;
    analysisMethod?: S.FaceAnalysisMethod;
    minConfidence?: number;
    deleted?: boolean;
    /** Only the people in this group of the user's (#1126); "Unknown - Other" still comes last. */
    group?: number;
  } = {}
): Promise<S.IncompleteFacesResponse> {
  const query = buildQuery({
    inferred: params.inferred ?? false,
    order_by: params.orderBy ?? "confidence",
    analysis_method: params.inferred ? (params.analysisMethod ?? "clustering") : undefined,
    min_confidence: params.minConfidence,
    deleted: params.deleted || undefined,
    group: params.group,
  });
  const res = await client.get<unknown>(`/faces/incomplete/${query}`);
  return parseResponse(S.IncompleteFacesResponse, res, "incomplete faces");
}

/**
 * Assign faces to a person by name (auto-creates the person). Passing the
 * unknown sentinel name rejects the faces back to unknown instead.
 */
export async function labelFaces(
  client: ApiClient,
  faceIds: number[],
  personName: string
): Promise<S.SetFacesLabelResponse> {
  const res = await client.post<unknown>("/labelfaces", { face_ids: faceIds, person_name: personName });
  return parseResponse(S.SetFacesLabelResponse, res, "label faces");
}

export async function deleteFaces(client: ApiClient, faceIds: number[]): Promise<S.DeleteFacesResponse> {
  const res = await client.post<unknown>("/deletefaces", { face_ids: faceIds });
  return parseResponse(S.DeleteFacesResponse, res, "delete faces");
}

/** Bring deleted faces back to the person each one had (#127); other ids are skipped. */
export async function restoreFaces(client: ApiClient, faceIds: number[]): Promise<S.RestoreFacesResponse> {
  const res = await client.post<unknown>("/restore-faces/", { face_ids: faceIds });
  return parseResponse(S.RestoreFacesResponse, res, "restore faces");
}

/** Undo a labelling: give the faces back the people `labelFaces` answered as `previous` (#127). */
export async function restoreFaceLabels(
  client: ApiClient,
  faces: readonly S.FaceLabels[]
): Promise<S.RestoreFacesResponse> {
  const res = await client.post<unknown>("/restore-face-labels/", { faces });
  return parseResponse(S.RestoreFacesResponse, res, "restore face labels");
}

export async function trainFaces(client: ApiClient): Promise<S.JobTriggerResponse> {
  return triggerJob(client, "/trainfaces", S.JobTriggerResponse, "train faces");
}

/** Where a face scan looks (#524): every photo, one folder (and those below it), or some photos. */
export type FaceScanScope = Record<string, never> | { path: string } | { photo_ids: readonly string[] };

/**
 * Detect faces again in every photo, or with `scope` in one folder or some photos of the user's
 * (#524). ApiError 403 when face detection is turned off, 400 for a folder outside the library,
 * 404 when none of the photos is the user's.
 */
export async function scanFaces(client: ApiClient, scope: FaceScanScope = {}): Promise<S.JobTriggerResponse> {
  return triggerJob(client, "/scanfaces", S.JobTriggerResponse, "scan faces", scope);
}

/**
 * Add a face from a box drawn on a photo (by id or image hash) and name its person, who is created
 * when new. ApiError 409 for a box over an existing face, 404 for a photo that is not the user's,
 * 400 for a box the server cannot use.
 */
export async function addFace(
  client: ApiClient,
  photo: string,
  personName: string,
  box: S.NormalizedFaceBox
): Promise<S.AddFaceResponse> {
  const res = await client.post<unknown>("/addface", { photo, person_name: personName, box });
  return parseResponse(S.AddFaceResponse, res, "add face");
}

/** Every face with an encoding, projected onto three axes for the face cluster chart. */
export async function fetchClusterFaces(client: ApiClient): Promise<S.ClusterFacesResponse> {
  const res = await client.get<unknown>("/clusterfaces");
  return parseResponse(S.ClusterFacesResponse, res, "cluster faces");
}

/* ---- statistics --------------------------------------------------------- */

export async function fetchCountStats(client: ApiClient): Promise<S.CountStats> {
  const res = await client.get<unknown>("/stats/");
  return parseResponse(S.CountStats, res, "count stats");
}

export async function fetchLocationSunburst(client: ApiClient): Promise<S.LocationSunburst> {
  const res = await client.get<unknown>("/locationsunburst/");
  return parseResponse(S.LocationSunburst, res, "location tree");
}

export async function fetchPhotoMonthCounts(client: ApiClient): Promise<S.PhotoMonthCountResponse> {
  const res = await client.get<unknown>("/photomonthcounts/");
  return parseResponse(S.PhotoMonthCountResponse, res, "photo month counts");
}

export async function fetchSocialGraph(client: ApiClient): Promise<S.SocialGraph> {
  const res = await client.get<unknown>("/socialgraph/");
  return parseResponse(S.SocialGraph, res, "social graph");
}

export async function fetchWordCloud(client: ApiClient): Promise<S.WordCloudResponse> {
  const res = await client.get<unknown>("/wordcloud/");
  return parseResponse(S.WordCloudResponse, res, "word cloud");
}

export async function fetchLocationTimeline(client: ApiClient): Promise<S.LocationTimeline> {
  const res = await client.get<unknown>("/locationtimeline/");
  return parseResponse(S.LocationTimeline, res, "location timeline");
}

/* ---- server ------------------------------------------------------------- */

/** The build the server runs (image tag and git hash). */
export async function fetchImageTag(client: ApiClient): Promise<S.ImageTag> {
  const res = await client.get<unknown>("/imagetag/");
  return parseResponse(S.ImageTag, res, "image tag");
}

/** Disk space where the server keeps its data (bytes). */
export async function fetchStorageStats(client: ApiClient): Promise<S.StorageStats> {
  const res = await client.get<unknown>("/storagestats/");
  return parseResponse(S.StorageStats, res, "storage stats");
}

/** Admin: the machine and every user's library. */
export async function fetchServerStats(client: ApiClient): Promise<S.ServerStats> {
  const res = await client.get<unknown>("/serverstats/");
  return parseResponse(S.ServerStats, res, "server stats");
}

/** Admin: the last `lines` lines of the server log. ApiError 404 when there is no log file. */
export async function fetchServerLogs(client: ApiClient, lines: number): Promise<S.ServerLogs> {
  const res = await client.get<unknown>(`/serverlogs/view${buildQuery({ lines })}`);
  return parseResponse(S.ServerLogs, res, "server logs");
}

/** Admin: the whole server log file, to save. */
export async function fetchServerLogFile(client: ApiClient): Promise<Blob> {
  return client.getBlob("/serverlogs");
}

/* ---- health ------------------------------------------------------------- */

const READY: S.BackendReadiness = { state: "ready" };
const UNREACHABLE: S.BackendNotReady = { state: "unreachable", reasonCode: null, version: null };

/** A proxy's answer for a server that does not answer (Bad Gateway, Gateway Timeout). */
const GATEWAY_ERRORS = new Set([502, 504]);

/**
 * The startup placeholder's 503 names its phase; any other 503 (the running server's own when a
 * dependency is down, or a proxy's) does not.
 */
function startupReadiness(body: unknown): S.BackendReadiness {
  const startup = S.StartupStatus.safeParse(body);
  if (!startup.success) return UNREACHABLE;
  const { status, reason_code: reasonCode, version } = startup.data;
  return { state: status, reasonCode: reasonCode ?? null, version: version ?? null };
}

/** What a readiness probe that did not answer 200 says about the server. */
function readinessFromError(error: unknown): S.BackendReadiness {
  // No answer at all (fetch rejected: server down, network gone), or the proxy answered for it.
  if (!(error instanceof ApiError) || GATEWAY_ERRORS.has(error.status)) return UNREACHABLE;
  // Any other answer comes from the server, so it serves requests again: the app's own error
  // handling takes over from here, rather than a status screen that could never go away.
  return error.status === 503 ? startupReadiness(error.body) : READY;
}

/**
 * Whether the server serves requests yet (`/healthz/ready/`). Never rejects: a 200 is `ready`
 * (its `HealthReady` body is not needed), a 503 from the startup placeholder names its phase
 * (`StartupStatus`), and no answer, a proxy's 502-504 or another 503 is `unreachable`.
 */
export async function fetchBackendReadiness(client: ApiClient): Promise<S.BackendReadiness> {
  try {
    await client.get<unknown>("/healthz/ready/");
    return READY;
  } catch (error) {
    return readinessFromError(error);
  }
}

/* ---- services (sidecars) ------------------------------------------------ */

/** Admin: every sidecar service by name. */
export async function fetchServices(client: ApiClient): Promise<S.ServicesList> {
  const res = await client.get<unknown>("/services/");
  return parseResponse(S.ServicesList, res, "services list");
}

/** Admin: whether one service is turned on and answering. */
export async function fetchServiceHealth(client: ApiClient, serviceName: string): Promise<S.ServiceHealth> {
  const res = await client.get<unknown>(`/services/${serviceName}/`);
  return parseResponse(S.ServiceHealth, res, `health of ${serviceName}`);
}

/** Admin: start or stop a service (ApiError 409 `service_disabled` for one its feature flag turns off). */
export async function runServiceAction(
  client: ApiClient,
  serviceName: string,
  action: "start" | "stop"
): Promise<S.ServiceActionResponse> {
  const res = await client.post<unknown>(`/services/${serviceName}/${action}/`);
  return parseResponse(S.ServiceActionResponse, res, `${action} ${serviceName}`);
}

/* ---- upload (chunked) --------------------------------------------------- */

/**
 * Send one chunk of a file: `form_data` holds the chunk (`file`), `offset`, `md5` and, after the
 * first chunk, the `upload_id` the server answered. Answers the upload and the bytes it holds.
 */
export async function uploadChunk(client: ApiClient, options: S.UploadOptions): Promise<S.UploadResponse> {
  const end = options.offset + options.chunk_size - 1;
  const res = await client.request<unknown>("/upload/", {
    method: "POST",
    body: options.form_data,
    headers: new Headers({ "Content-Range": `bytes ${options.offset}-${end}/${options.chunk_size}` }),
  });
  return parseResponse(S.UploadResponse, res, "upload chunk");
}

/**
 * Finish a chunked upload (`upload_id`, `md5`, `filename` in the form): the server imports the file.
 * An `album_id` in the form also adds it to that album of the uploader's (#612); an album the server
 * refuses is a 400 with code `album_not_found` or `album_locked`, after which the same upload can
 * be completed again without it.
 */
export async function completeUpload(client: ApiClient, formData: FormData): Promise<S.UploadCompleteResponse> {
  const res = await client.post<unknown>("/upload/complete/", formData);
  return parseResponse(S.UploadCompleteResponse, res, "upload complete");
}

/**
 * Whether the user already has a file with this MD5 (the server keys uploads by MD5 plus user id),
 * and that photo's id.
 */
export async function uploadExists(client: ApiClient, md5: string, userId: number): Promise<S.UploadExistsResponse> {
  const res = await client.get<unknown>(`/exists/${md5}${userId}`);
  return parseResponse(S.UploadExistsResponse, res, "upload exists");
}

/* ---- folders ------------------------------------------------------------ */

/**
 * Admin: the folders below `path` on the server (the data root when it is blank), for picking a
 * scan directory. ApiError 403 for a path outside the data root.
 */
export async function fetchDirTree(client: ApiClient, path: string): Promise<S.DirTreeResponse> {
  // Always sent, blank included; encoded so "&", "#" or "+" in a folder name do not cut it short.
  const res = await client.get<unknown>(`/dirtree/?path=${encodeURIComponent(path)}`);
  return parseResponse(S.DirTreeResponse, res, "directory tree");
}

/** The folders at the top of the user's Nextcloud. */
export async function fetchNextcloudDirs(client: ApiClient): Promise<S.DirTreeResponse> {
  const res = await client.get<unknown>("/nextcloud/listdir/?fpath=/");
  return parseResponse(S.DirTreeResponse, res, "Nextcloud directories");
}

/* ---- geocode ------------------------------------------------------------ */

/** Places matching a name, for the location picker (the server asks its geocoder). */
export async function searchGeocode(client: ApiClient, query: string): Promise<S.GeocodeSearchResponse> {
  const res = await client.get<unknown>(`/geocode/search?q=${encodeURIComponent(query)}`);
  return parseResponse(S.GeocodeSearchResponse, res, "geocode search");
}

/** The place name at a spot, for the location picker before it saves. */
export async function reverseGeocode(client: ApiClient, lat: number, lon: number): Promise<S.GeocodeReverseResponse> {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon) });
  const res = await client.get<unknown>(`/geocode/reverse/?${params.toString()}`);
  return parseResponse(S.GeocodeReverseResponse, res, "reverse geocode");
}

/* ---- photo locations (#2279) -------------------------------------------- */

/**
 * Move the selected photos (by hash, or a selected-all set) to one spot, looked up once. With
 * `overwrite` false the photos that already have a location keep it.
 */
export async function setPhotosLocation(
  client: ApiClient,
  imageHashes: string[],
  location: { lat: number; lon: number; overwrite: boolean },
  selectAll?: SelectAllPhotos
): Promise<S.SetPhotosLocationResponse> {
  const res = await client.post<unknown>("/photosedit/location/", {
    ...photoSelection(imageHashes, selectAll),
    ...location,
  });
  return parseResponse(S.SetPhotosLocationResponse, res, "set photos location");
}

/** How many of the selected photos have a location, and when the selection was taken. */
export async function fetchLocationSummary(
  client: ApiClient,
  imageHashes: string[],
  selectAll?: SelectAllPhotos
): Promise<S.LocationSummaryResponse> {
  const res = await client.post<unknown>("/photos/location-summary/", photoSelection(imageHashes, selectAll));
  return parseResponse(S.LocationSummaryResponse, res, "location summary");
}

/** The user's geotagged photos taken from `from` to `to` (ISO date-times), nearest to the middle first. */
export async function fetchLocatedNearbyInTime(
  client: ApiClient,
  from: string,
  to: string
): Promise<S.LocatedPhotosResponse> {
  const params = new URLSearchParams({ from, to });
  const res = await client.get<unknown>(`/photos/located-nearby-in-time/?${params.toString()}`);
  return parseResponse(S.LocatedPhotosResponse, res, "photos located nearby in time");
}

/* ---- moving photos (#352) ----------------------------------------------- */

/** Where the selected photos go and what to do with a name taken there (absent: a 409 `name_conflict`). */
export type MovePhotosTarget = { targetFolder: string; onConflict?: S.MoveOnConflict };

/** What moving the selected photos to `targetFolder` would do: counts, refusals and taken names. */
export async function previewPhotosMove(
  client: ApiClient,
  imageHashes: string[],
  targetFolder: string,
  selectAll?: SelectAllPhotos
): Promise<S.MovePreviewResponse> {
  const res = await client.post<unknown>("/photos/move/preview/", {
    ...photoSelection(imageHashes, selectAll),
    target_folder: targetFolder,
  });
  return parseResponse(S.MovePreviewResponse, res, "preview photos move");
}

/**
 * Move the selected photos, with all their files, to a folder of the library. A small selection
 * answers the counts; a large one the "Move Photos" job that does it (`job_id`).
 */
export async function movePhotos(
  client: ApiClient,
  imageHashes: string[],
  target: MovePhotosTarget,
  selectAll?: SelectAllPhotos
): Promise<S.MovePhotosAnswer> {
  const res = await client.post<unknown>("/photos/move/", {
    ...photoSelection(imageHashes, selectAll),
    target_folder: target.targetFolder,
    ...(target.onConflict ? { on_conflict: target.onConflict } : {}),
  });
  return parseResponse(S.MovePhotosAnswer, res, "move photos");
}

/** The subfolders of `path` a move can go to; without it the library folders themselves. */
export async function fetchMoveFolders(client: ApiClient, path: string | null): Promise<S.LibraryFolderListing> {
  const query = path === null ? "" : `?${new URLSearchParams({ path }).toString()}`;
  const res = await client.get<unknown>(`/photos/move/folders/${query}`);
  return parseResponse(S.LibraryFolderListing, res, "move folders");
}

/* ---- media -------------------------------------------------------------- */

/** Admin: why the web server refused to serve this photo's original. */
export async function fetchMediaDiagnostics(client: ApiClient, mediaHash: string): Promise<S.MediaDiagnostics> {
  const res = await client.get<unknown>(`/media/diagnostics/${mediaHash}/`);
  return parseResponse(S.MediaDiagnostics, res, "media diagnostics");
}

/* ---- memories ----------------------------------------------------------- */

/**
 * Today's memories: photos from this date in earlier years. Each memory carries a page of its
 * photos; `size` asks for bigger pages (up to MAX_MEMORY_ITEMS).
 */
export async function fetchMemories(client: ApiClient, size?: number): Promise<S.FetchMemoriesResponse> {
  const res = await client.get<unknown>(size ? `/memories${buildQuery({ size })}` : "/memories");
  return parseResponse(S.FetchMemoriesResponse, res, "memories");
}

/* ---- delta sync (mobile app, backend api/views/sync.py) ----------------- */

/** Pull parameters for a keyset-paginated delta feed. */
export type SyncPullParams = {
  /** Loop-continuation cursor (server `next_cursor`); omit/null for a seed pull. */
  cursor?: string | null;
  /** Page size (server caps at 1000). */
  pageSize?: number;
};

function syncQuery(params: SyncPullParams): string {
  return buildQuery({ cursor: params.cursor ?? undefined, page_size: params.pageSize });
}

export async function syncPhotos(client: ApiClient, params: SyncPullParams = {}): Promise<S.SyncPhotosResponse> {
  const res = await client.get<unknown>(`/sync/photos/${syncQuery(params)}`);
  return parseResponse(S.SyncPhotosResponse, res, "sync photos");
}

export async function syncPersons(client: ApiClient, params: SyncPullParams = {}): Promise<S.SyncPersonsResponse> {
  const res = await client.get<unknown>(`/sync/persons/${syncQuery(params)}`);
  return parseResponse(S.SyncPersonsResponse, res, "sync persons");
}

export async function syncUserAlbums(
  client: ApiClient,
  params: SyncPullParams = {}
): Promise<S.SyncUserAlbumsResponse> {
  const res = await client.get<unknown>(`/sync/albums/user/${syncQuery(params)}`);
  return parseResponse(S.SyncUserAlbumsResponse, res, "sync user albums");
}

export async function syncAutoAlbums(
  client: ApiClient,
  params: SyncPullParams = {}
): Promise<S.SyncAutoAlbumsResponse> {
  const res = await client.get<unknown>(`/sync/albums/auto/${syncQuery(params)}`);
  return parseResponse(S.SyncAutoAlbumsResponse, res, "sync auto albums");
}

export async function syncThingAlbums(
  client: ApiClient,
  params: SyncPullParams = {}
): Promise<S.SyncThingAlbumsResponse> {
  const res = await client.get<unknown>(`/sync/albums/thing/${syncQuery(params)}`);
  return parseResponse(S.SyncThingAlbumsResponse, res, "sync thing albums");
}

export async function syncPlaceAlbums(
  client: ApiClient,
  params: SyncPullParams = {}
): Promise<S.SyncPlaceAlbumsResponse> {
  const res = await client.get<unknown>(`/sync/albums/place/${syncQuery(params)}`);
  return parseResponse(S.SyncPlaceAlbumsResponse, res, "sync place albums");
}

export async function syncTagAlbums(client: ApiClient, params: SyncPullParams = {}): Promise<S.SyncTagAlbumsResponse> {
  const res = await client.get<unknown>(`/sync/albums/tag/${syncQuery(params)}`);
  return parseResponse(S.SyncTagAlbumsResponse, res, "sync tag albums");
}

export async function syncSharing(client: ApiClient, params: SyncPullParams = {}): Promise<S.SyncSharingResponse> {
  const res = await client.get<unknown>(`/sync/sharing/${syncQuery(params)}`);
  return parseResponse(S.SyncSharingResponse, res, "sync sharing");
}

export async function syncCounts(client: ApiClient): Promise<S.SyncCounts> {
  const res = await client.get<unknown>("/sync/counts/");
  return parseResponse(S.SyncCounts, res, "sync counts");
}

/* ---- photo / album / person mutations (offline outbox, doc 03 §6) ------- *
 * Thin wrappers over the same endpoints the web frontend uses. The mobile
 * outbox replay engine calls these when draining offline mutations; the next
 * delta pull re-materializes authoritative row state, so responses are only
 * lightly validated (favorite = rating; hide/trash = flag toggles).
 * ----------------------------------------------------------------------- */

/** Toggle favorite on a set of photos (favorite = rating ≥ favorite_min_rating). By hash, or selected-all. */
export async function setPhotosFavorite(
  client: ApiClient,
  imageHashes: string[],
  favorite: boolean,
  selectAll?: SelectAllPhotos
): Promise<S.BulkPhotoMutationResponse> {
  const res = await client.post<unknown>("/photosedit/favorite/", {
    ...photoSelection(imageHashes, selectAll),
    favorite,
  });
  return parseResponse(S.BulkPhotoMutationResponse, res, "set favorite");
}

/** Toggle hidden on a set of photos. By hash, or selected-all. */
export async function setPhotosHidden(
  client: ApiClient,
  imageHashes: string[],
  hidden: boolean,
  selectAll?: SelectAllPhotos
): Promise<S.BulkPhotoMutationResponse> {
  const res = await client.post<unknown>("/photosedit/hide/", { ...photoSelection(imageHashes, selectAll), hidden });
  return parseResponse(S.BulkPhotoMutationResponse, res, "set hidden");
}

/**
 * Archive or unarchive photos (#545): archived photos leave the timeline and Memories but stay in
 * albums, people, places, folders and search. By hash, or selected-all.
 */
export async function setPhotosArchived(
  client: ApiClient,
  imageHashes: string[],
  archived: boolean,
  selectAll?: SelectAllPhotos
): Promise<S.BulkPhotoMutationResponse> {
  const res = await client.post<unknown>("/photosedit/archive/", {
    ...photoSelection(imageHashes, selectAll),
    archived,
  });
  return parseResponse(S.BulkPhotoMutationResponse, res, "set archived");
}

/** Move photos to / restore from the trashcan (soft delete). By hash, or selected-all. */
export async function setPhotosDeleted(
  client: ApiClient,
  imageHashes: string[],
  deleted: boolean,
  selectAll?: SelectAllPhotos
): Promise<S.BulkPhotoMutationResponse> {
  const res = await client.post<unknown>("/photosedit/setdeleted/", {
    ...photoSelection(imageHashes, selectAll),
    deleted,
  });
  return parseResponse(S.BulkPhotoMutationResponse, res, "set deleted");
}

/** What a photo is: a photo, a screenshot or a document. */
export type PhotoCategory = "photo" | "screenshot" | "document";

/**
 * Set the category of photos (by hash or selected-all), pinned as the user's so rescans keep it.
 * "auto" hands them back to the detectors (hashes only; the server refuses it for select-all).
 */
export async function setPhotosCategory(
  client: ApiClient,
  imageHashes: string[],
  category: PhotoCategory | "auto",
  selectAll?: SelectAllPhotos
): Promise<S.BulkPhotoMutationResponse> {
  const res = await client.post<unknown>("/photosedit/category/", {
    ...photoSelection(imageHashes, selectAll),
    category,
  });
  return parseResponse(S.BulkPhotoMutationResponse, res, "set photos category");
}

/** Delete photos for good, with their files: only those in the trash (by hash, or selected-all). */
export async function deletePhotos(
  client: ApiClient,
  imageHashes: string[],
  selectAll?: SelectAllPhotos
): Promise<S.DeletePhotosResponse> {
  const res = await client.delete<unknown>("/photosedit/delete/", photoSelection(imageHashes, selectAll));
  return parseResponse(S.DeletePhotosResponse, res, "delete photos");
}

/**
 * Set a 0–5 star rating on photos (keyed by image hash).
 *
 * `/photosedit/rating/` is the favorite toggle's sibling (the web app's stars
 * mode and the mobile star row call it): owner-scoped, bumps each photo's
 * `last_modified` so the next delta pull carries the rating, and writes it to
 * the file or sidecar when the user syncs metadata to disk. Not
 * `PATCH /photos/edit/{hash}/`: that endpoint ignores `rating` and still
 * answers 200, so every rating was silently dropped. Hashes only: the server
 * refuses a select-all rating.
 */
export async function setPhotosRating(
  client: ApiClient,
  imageHashes: string[],
  rating: number
): Promise<S.BulkPhotoMutationResponse> {
  const res = await client.post<unknown>("/photosedit/rating/", {
    image_hashes: imageHashes,
    rating,
  });
  return parseResponse(S.BulkPhotoMutationResponse, res, "set rating");
}

/** Set a 0–5 star rating on one photo (the mobile outbox replays one photo at a time). */
export async function setPhotoRating(
  client: ApiClient,
  imageHash: string,
  rating: number
): Promise<S.BulkPhotoMutationResponse> {
  return setPhotosRating(client, [imageHash], rating);
}

/**
 * Set (or clear) one photo's EXIF capture timestamp.
 *
 * `PATCH /photos/edit/{hash}/`. The backend expects a naive
 * `YYYY-MM-DDTHH:mm:ss` local timestamp, and `null` to mark the photo as
 * having no timestamp at all. Deliberately **not** an outbox mutation: the
 * timestamp drives timeline ordering and day/month bucketing, so an optimistic
 * offline write would reshuffle a client's whole timeline against a change the
 * server has not accepted.
 */
export async function setPhotoTimestamp(
  client: ApiClient,
  imageHash: string,
  timestamp: string | null
): Promise<S.PhotoEditResponse> {
  const res = await client.patch<unknown>(`/photos/edit/${imageHash}/`, {
    exif_timestamp: timestamp,
  });
  return parseResponse(S.PhotoEditResponse, res, "set timestamp");
}

/** How a bulk date change moves the photos: by a number of seconds, or all to one wall-clock time. */
export type DateTimeChange = { mode: "shift"; seconds: number } | { mode: "set"; datetime: string };

/**
 * Shift the date of photos by `seconds` (negative for earlier), or give them all one date and time
 * (#2278). By hash, or selected-all. The new date is the user's: it wins over the date rules and is
 * written to the files when the user syncs metadata to disk. A shift skips photos without a date.
 */
export async function setPhotosDateTime(
  client: ApiClient,
  imageHashes: string[],
  change: DateTimeChange,
  selectAll?: SelectAllPhotos
): Promise<S.SetPhotosDateTimeResponse> {
  const res = await client.post<unknown>("/photosedit/datetime/", {
    ...photoSelection(imageHashes, selectAll),
    ...change,
  });
  return parseResponse(S.SetPhotosDateTimeResponse, res, "set photos date and time");
}

/** The dates of a selection (by hash, or selected-all): counts and the oldest and newest dated photo. */
export async function fetchDateSummary(
  client: ApiClient,
  imageHashes: string[],
  selectAll?: SelectAllPhotos
): Promise<S.DateSummary> {
  const res = await client.post<unknown>("/photos/date-summary/", photoSelection(imageHashes, selectAll));
  return parseResponse(S.DateSummary, res, "date summary");
}

/** Save a user caption on one photo. */
export async function savePhotoCaption(
  client: ApiClient,
  imageHash: string,
  caption: string
): Promise<S.StatusResponse> {
  const res = await client.post<unknown>("/photosedit/savecaption/", {
    image_hash: imageHash,
    caption,
  });
  return parseResponse(S.StatusResponse, res, "save caption");
}

/**
 * Server-side "select all": instead of listing every photo, the query that describes the photo set
 * (as the bulk photo mutations take it) and the photos left out of it.
 */
export type SelectAllPhotos = {
  query?: S.BulkPhotoQuery;
  excludedHashes?: string[];
};

/**
 * Which photos a bulk photo mutation applies to: the hashes, or with `selectAll` the query and its
 * exclusions (`select_all`, `query`, `excluded_hashes`; what is not set is left out).
 */
function photoSelection(imageHashes: string[], selectAll: SelectAllPhotos | undefined) {
  if (!selectAll) return { image_hashes: imageHashes };
  return { select_all: true, query: selectAll.query, excluded_hashes: selectAll.excludedHashes };
}

function userAlbumPhotosBody(title: string, photoIds: string[], selectAll: SelectAllPhotos | undefined) {
  if (!selectAll) return { title, photos: photoIds };
  return {
    title,
    photos: [],
    select_all: true,
    query: selectAll.query ?? {},
    excluded_hashes: selectAll.excludedHashes ?? [],
  };
}

/** Create a user album with an initial photo set (photo ids = UUID pks), or a selected-all one. */
export async function createUserAlbum(
  client: ApiClient,
  title: string,
  photoIds: string[],
  selectAll?: SelectAllPhotos
): Promise<S.CreateUserAlbumResponse> {
  const res = await client.post<unknown>("/albums/user/edit/", userAlbumPhotosBody(title, photoIds, selectAll));
  return parseResponse(S.CreateUserAlbumResponse, res, "create user album");
}

/**
 * Add photos by UUID pk to a user album without naming its title, so a rename made meanwhile stays
 * (an upload filing files the library already had, #612).
 */
export async function addPhotosToUserAlbumById(
  client: ApiClient,
  albumId: number | string,
  photoIds: string[]
): Promise<S.UserAlbumEditResponse> {
  const res = await client.patch<unknown>(`/albums/user/edit/${albumId}/`, { photos: photoIds });
  return parseResponse(S.UserAlbumEditResponse, res, "add photos to user album by id");
}

/** Add photos (by UUID pk, or a selected-all set) to an existing user album. */
export async function addPhotosToUserAlbum(
  client: ApiClient,
  albumId: number | string,
  title: string,
  photoIds: string[],
  selectAll?: SelectAllPhotos
): Promise<S.UserAlbumEditResponse> {
  const body = userAlbumPhotosBody(title, photoIds, selectAll);
  const res = await client.patch<unknown>(`/albums/user/edit/${albumId}/`, body);
  return parseResponse(S.UserAlbumEditResponse, res, "add photos to user album");
}

/** Remove photos (by image hash) from a user album. */
export async function removePhotosFromUserAlbum(
  client: ApiClient,
  albumId: number | string,
  imageHashes: string[]
): Promise<S.UserAlbumEditResponse> {
  const res = await client.patch<unknown>(`/albums/user/edit/${albumId}/`, { removedPhotos: imageHashes });
  return parseResponse(S.UserAlbumEditResponse, res, "remove photos from user album");
}

/** Set a user album's cover photo. */
export async function setUserAlbumCover(
  client: ApiClient,
  albumId: number | string,
  coverPhoto: string
): Promise<S.UserAlbumEditResponse> {
  const res = await client.patch<unknown>(`/albums/user/edit/${albumId}/`, { cover_photo: coverPhoto });
  return parseResponse(S.UserAlbumEditResponse, res, "set user album cover");
}

/** Lock a user album against changes to its photos, or unlock it. */
export async function setUserAlbumLocked(
  client: ApiClient,
  albumId: number | string,
  locked: boolean
): Promise<S.UserAlbumEditResponse> {
  const res = await client.patch<unknown>(`/albums/user/edit/${albumId}/`, { locked });
  return parseResponse(S.UserAlbumEditResponse, res, "lock user album");
}

/** Rename a user album. */
export async function renameUserAlbum(
  client: ApiClient,
  albumId: number | string,
  title: string
): Promise<S.UserAlbumRenameResponse> {
  const res = await client.patch<unknown>(`/albums/user/${albumId}/`, { title });
  return parseResponse(S.UserAlbumRenameResponse, res, "rename user album");
}

/** Delete a user album; its photos stay. Answers 204. */
export async function deleteUserAlbum(client: ApiClient, albumId: number | string): Promise<void> {
  await client.delete(`/albums/user/${albumId}/`);
}

/* ---- album collections (#1009) ----------------------------------------- */

/** The user's album collections by name, all pages. */
export async function fetchAlbumCollections(client: ApiClient): Promise<S.AlbumCollection[]> {
  const results = await fetchAllPages(client, "/albums/collections/");
  return parseResponse(S.AlbumCollectionListResponse, { results }, "album collections").results;
}

/** Create a collection. A name the user already has (in any letter case) is a 400 on `name`. */
export async function createAlbumCollection(client: ApiClient, name: string): Promise<S.AlbumCollection> {
  const res = await client.post<unknown>("/albums/collections/", { name });
  return parseResponse(S.AlbumCollection, res, "create album collection");
}

/** Rename a collection. */
export async function renameAlbumCollection(
  client: ApiClient,
  collectionId: number,
  name: string
): Promise<S.AlbumCollection> {
  const res = await client.patch<unknown>(`/albums/collections/${collectionId}/`, { name });
  return parseResponse(S.AlbumCollection, res, "rename album collection");
}

/** Delete a collection; its albums stay. Answers 204. */
export async function deleteAlbumCollection(client: ApiClient, collectionId: number): Promise<void> {
  await client.delete(`/albums/collections/${collectionId}/`);
}

/** Put a user album in exactly these collections of its owner. */
export async function setUserAlbumCollections(
  client: ApiClient,
  albumId: number | string,
  collectionIds: number[]
): Promise<S.UserAlbumCollections> {
  const res = await client.request<unknown>(`/albums/user/${albumId}/collections/`, {
    method: "PUT",
    body: { collection_ids: collectionIds },
  });
  return parseResponse(S.UserAlbumCollections, res, "set user album collections");
}

/**
 * Pick an event's cover (#429): one of its photos by id, or null for the automatic cover. A photo
 * outside the event is a 400 `not_in_event`.
 */
export async function setAutoAlbumCover(
  client: ApiClient,
  albumId: number | string,
  coverPhoto: string | null
): Promise<S.AutoAlbumEdit> {
  const res = await client.patch<unknown>(`/albums/auto/${albumId}/`, { cover_photo: coverPhoto });
  return parseResponse(S.AutoAlbumEdit, res, "set event cover");
}

/** Delete one event album. Answers 204. */
export async function deleteAutoAlbum(client: ApiClient, albumId: number | string): Promise<void> {
  await client.delete(`/albums/auto/${albumId}/`);
}

/** Delete every event album of the user. The server answers the string "success". */
export async function deleteAllAutoAlbums(client: ApiClient): Promise<string> {
  const res = await client.post<unknown>("/albums/auto/delete_all/");
  return parseResponse(z.string(), res, "delete all event albums");
}
