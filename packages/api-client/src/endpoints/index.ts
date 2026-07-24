import type { ApiClient } from "../transport/types";
import * as S from "../schemas";
import { buildQuery, parseResponse } from "../util/parse";
import { Photoset } from "../schemas";

/* ---------------------------------------------------------------------- *
 * Thin, platform-agnostic endpoint wrappers. Each takes an ApiClient and
 * returns parsed, typed data. No React here — hooks build on top of these.
 * ---------------------------------------------------------------------- */

/* ---- auth -------------------------------------------------------------- */

export async function login(client: ApiClient, credentials: S.LoginPost): Promise<S.LoginResponse> {
  const res = await client.post<unknown>("/auth/token/obtain/", credentials);
  return parseResponse(S.LoginResponse, res, "login response");
}

export function logout(client: ApiClient, refresh: string): Promise<unknown> {
  return client.post("/auth/token/blacklist/", { refresh });
}

/* ---- user -------------------------------------------------------------- */

export async function fetchUserSelfDetails(client: ApiClient, userId: string | number): Promise<S.User> {
  const res = await client.get<unknown>(`/user/${userId}/`);
  return parseResponse(S.User, res, "user self details");
}

export async function fetchUserList(client: ApiClient): Promise<S.ListUserList> {
  const res = await client.get<{ results?: unknown } | unknown[]>("/user/");
  const results = Array.isArray(res) ? res : ((res as { results?: unknown }).results ?? []);
  return parseResponse(S.ListUserList, results, "user list");
}

/* ---- date albums (timeline) ------------------------------------------- */

export type DateAlbumFilter = {
  favorite?: boolean;
  public?: boolean;
  hidden?: boolean;
  in_trashcan?: boolean;
  photo?: boolean;
  video?: boolean;
  is_screenshot?: boolean;
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
    in_trashcan: photoset === Photoset.IN_TRASHCAN || undefined,
    photo: photoset === Photoset.PHOTOS || undefined,
    video: photoset === Photoset.VIDEOS || undefined,
    is_screenshot: photoset === Photoset.SCREENSHOTS || undefined,
  };
}

export async function fetchDateAlbumsList(
  client: ApiClient,
  filter: DateAlbumFilter = {}
): Promise<S.IncompleteDatePhotosGroup[]> {
  const query = buildQuery({
    favorite: filter.favorite ? "true" : undefined,
    public: filter.public ? "true" : undefined,
    hidden: filter.hidden ? "true" : undefined,
    in_trashcan: filter.in_trashcan ? "true" : undefined,
    photo: filter.photo ? "true" : undefined,
    video: filter.video ? "true" : undefined,
    is_screenshot: filter.is_screenshot ? "true" : undefined,
    person: filter.person,
    username: filter.username?.toLowerCase(),
    folder: filter.folder,
  });
  const res = await client.get<unknown>(`/albums/date/list/${query}`);
  return parseResponse(S.FetchDateAlbumsListResponse, res, "date albums list").results;
}

export async function fetchDateAlbum(
  client: ApiClient,
  albumDateId: string,
  page: number,
  filter: DateAlbumFilter = {}
): Promise<S.IncompleteDatePhotosGroup> {
  const query = buildQuery({
    favorite: filter.favorite ? "true" : undefined,
    public: filter.public ? "true" : undefined,
    hidden: filter.hidden ? "true" : undefined,
    in_trashcan: filter.in_trashcan ? "true" : undefined,
    photo: filter.photo ? "true" : undefined,
    video: filter.video ? "true" : undefined,
    is_screenshot: filter.is_screenshot ? "true" : undefined,
    person: filter.person,
    username: filter.username?.toLowerCase(),
    folder: filter.folder,
    page,
  });
  const res = await client.get<unknown>(`/albums/date/${albumDateId}${query}`);
  return parseResponse(S.FetchDateAlbumResponse, res, "date album").results;
}

/* ---- photos ------------------------------------------------------------ */

export async function fetchRecentlyAddedPhotos(client: ApiClient): Promise<S.RecentlyAddedPhotosResponse> {
  const res = await client.get<unknown>("/photos/recentlyadded/");
  return parseResponse(S.RecentlyAddedPhotosResponse, res, "recently added photos");
}

export async function fetchPhotoDetails(client: ApiClient, imageHash: string): Promise<S.Photo> {
  const res = await client.get<unknown>(`/photos/${imageHash}/`);
  return parseResponse(S.Photo, res, "photo details");
}

/** One page of photos that have no EXIF timestamp (paginated). */
export async function fetchPhotosWithoutTimestamp(
  client: ApiClient,
  page: number
): Promise<S.PhotosWithoutTimestampResponse> {
  const res = await client.get<unknown>(`/photos/notimestamp/${buildQuery({ page })}`);
  return parseResponse(S.PhotosWithoutTimestampResponse, res, "photos without timestamp");
}

/* ---- albums (user / auto / thing / place) ----------------------------- */

export async function fetchUserAlbumsList(client: ApiClient): Promise<S.FetchUserAlbumsListResponse["results"]> {
  const res = await client.get<unknown>("/albums/user/list/");
  return parseResponse(S.FetchUserAlbumsListResponse, res, "user albums").results;
}

export async function fetchAutoAlbumsList(client: ApiClient): Promise<S.FetchAutoAlbumsListResponse["results"]> {
  const res = await client.get<unknown>("/albums/auto/list/");
  return parseResponse(S.FetchAutoAlbumsListResponse, res, "auto albums").results;
}

/** Full user-album detail incl. grouped photos (drives membership mirroring). */
export async function fetchUserAlbum(client: ApiClient, id: number | string): Promise<S.UserAlbum> {
  const res = await client.get<unknown>(`/albums/user/${id}/`);
  return parseResponse(S.UserAlbum, res, "user album detail");
}

/** Full auto-album detail incl. its photos (drives membership mirroring). */
export async function fetchAutoAlbum(client: ApiClient, id: number | string): Promise<S.AutoAlbum> {
  const res = await client.get<unknown>(`/albums/auto/${id}/`);
  return parseResponse(S.AutoAlbum, res, "auto album detail");
}

export async function fetchThingAlbumsList(client: ApiClient): Promise<S.FetchThingAlbumsListResponse["results"]> {
  const res = await client.get<unknown>("/albums/thing/list/");
  return parseResponse(S.FetchThingAlbumsListResponse, res, "thing albums").results;
}

export async function fetchPlaceAlbumsList(client: ApiClient): Promise<S.FetchPlaceAlbumsListResponse["results"]> {
  const res = await client.get<unknown>("/albums/place/list/");
  return parseResponse(S.FetchPlaceAlbumsListResponse, res, "place albums").results;
}

export async function fetchTagAlbumsList(client: ApiClient): Promise<S.TagListResponse["results"]> {
  const res = await client.get<unknown>("/tags/");
  return parseResponse(S.TagListResponse, res, "tag albums").results;
}

/** Photo grid (grouped by date) for one thing album. */
export async function fetchThingAlbum(client: ApiClient, id: number | string): Promise<S.ThingAlbum> {
  const res = await client.get<unknown>(`/albums/thing/${id}/`);
  return parseResponse(S.FetchThingAlbumResponse, res, "thing album detail").results;
}

/** Photo grid (grouped by date) for one place album. */
export async function fetchPlaceAlbum(client: ApiClient, id: number | string): Promise<S.PlaceAlbum> {
  const res = await client.get<unknown>(`/albums/place/${id}/`);
  return parseResponse(S.FetchPlaceAlbumResponse, res, "place album detail").results;
}

/** Photo grid (grouped by date) for one tag album. */
export async function fetchTagAlbum(client: ApiClient, id: number | string): Promise<S.TagAlbum> {
  const res = await client.get<unknown>(`/tags/${id}/`);
  return parseResponse(S.TagAlbumResponse, res, "tag album detail").results;
}

/* ---- persons ----------------------------------------------------------- */

export async function fetchPeopleAlbums(client: ApiClient): Promise<S.PersonList> {
  const res = await client.get<unknown>("/persons/");
  return parseResponse(S.FetchPeopleAlbumsResponse, res, "people albums").results;
}

/* ---- search ------------------------------------------------------------ */

export async function searchPhotos(
  client: ApiClient,
  searchTerm: string,
  semantic = false
): Promise<S.SearchPhotosResult> {
  const res = await client.get<unknown>(`/photos/searchlist/${buildQuery({ search: searchTerm })}`);
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

/* ---- settings ---------------------------------------------------------- */

export async function fetchSiteSettings(client: ApiClient): Promise<S.SiteSettings> {
  const res = await client.get<unknown>("/site-settings");
  return parseResponse(S.SiteSettings, res, "site settings");
}

export async function updateUserPartial(
  client: ApiClient,
  userId: string | number,
  patch: Record<string, unknown>
): Promise<S.User> {
  const res = await client.patch<unknown>(`/user/${userId}/`, patch);
  return parseResponse(S.User, res, "update user");
}

/* ---- jobs -------------------------------------------------------------- */

export async function fetchJobs(client: ApiClient, page = 0, pageSize = 20): Promise<S.JobsResponse> {
  const res = await client.get<unknown>(`/jobs/${buildQuery({ page, page_size: pageSize })}`);
  return parseResponse(S.JobsResponse, res, "jobs");
}

export async function fetchWorkerAvailability(client: ApiClient): Promise<S.WorkerAvailabilityResponse> {
  const res = await client.get<unknown>("/rqavailable/");
  return parseResponse(S.WorkerAvailabilityResponse, res, "worker availability");
}

/** Trigger an incremental library scan. Returns the queued job id. */
export async function scanPhotos(client: ApiClient): Promise<S.JobTriggerResponse> {
  const res = await client.post<unknown>("/scanphotos/", {});
  return parseResponse(S.JobTriggerResponse, res, "scan photos");
}

/** Trigger a full library rescan. */
export async function fullScanPhotos(client: ApiClient): Promise<S.JobTriggerResponse> {
  const res = await client.post<unknown>("/fullscanphotos/", {});
  return parseResponse(S.JobTriggerResponse, res, "full scan photos");
}

/* ---- sharing ----------------------------------------------------------- */

export async function fetchSharedPhotosByMe(client: ApiClient): Promise<S.SharedPhotosResponse["results"]> {
  const res = await client.get<unknown>("/photos/shared/fromme/");
  return parseResponse(S.SharedPhotosResponse, res, "shared photos by me").results;
}

export async function fetchSharedPhotosWithMe(client: ApiClient): Promise<S.SharedToMePhotosResponse["results"]> {
  const res = await client.get<unknown>("/photos/shared/tome/");
  return parseResponse(S.SharedToMePhotosResponse, res, "shared photos with me").results;
}

export async function fetchSharedAlbumsByMe(client: ApiClient): Promise<S.SharedAlbumsResponse["results"]> {
  const res = await client.get<{ results?: unknown } | unknown[]>("/albums/user/shared/fromme/");
  const results = Array.isArray(res) ? res : ((res as { results?: unknown }).results ?? []);
  return parseResponse(S.SharedAlbumsResponse, { results }, "shared albums by me").results;
}

export async function fetchSharedAlbumsWithMe(client: ApiClient): Promise<S.SharedAlbumsResponse["results"]> {
  const res = await client.get<{ results?: unknown } | unknown[]>("/albums/user/shared/tome/");
  const results = Array.isArray(res) ? res : ((res as { results?: unknown }).results ?? []);
  return parseResponse(S.SharedAlbumsResponse, { results }, "shared albums with me").results;
}

/** Share (or unshare) photos to another user by hash. */
export async function setPhotosShared(
  client: ApiClient,
  imageHashes: string[],
  targetUserId: number,
  shared: boolean
): Promise<unknown> {
  return client.post("/photosedit/share/", {
    image_hashes: imageHashes,
    target_user_id: targetUserId,
    val_shared: shared,
  });
}

/** Share (or unshare) a user album to another user. */
export async function setUserAlbumShared(
  client: ApiClient,
  albumId: number | string,
  targetUserId: number | string,
  shared: boolean
): Promise<unknown> {
  return client.post("/useralbum/share/", {
    album_id: String(albumId),
    target_user_id: String(targetUserId),
    shared,
  });
}

/* ---- public links ------------------------------------------------------ */

/** Make photos public (creates their public-gallery visibility) or private. */
export async function setPhotosPublic(
  client: ApiClient,
  imageHashes: string[],
  isPublic: boolean
): Promise<unknown> {
  return client.post("/photosedit/makepublic/", {
    image_hashes: imageHashes,
    val_public: isPublic,
  });
}

/** Toggle a user album's public link (optionally with slug/expiry). */
export async function setUserAlbumPublic(
  client: ApiClient,
  args: { albumId: number | string; isPublic: boolean; slug?: string; expiresAt?: string | null }
): Promise<unknown> {
  return client.post("/useralbum/makepublic", {
    album_id: String(args.albumId),
    val_public: args.isPublic,
    slug: args.slug,
    expires_at: args.expiresAt,
  });
}

/* ---- faces ------------------------------------------------------------- */

export type FaceListParams = {
  /** Person id; 0 (default) means unknown/other faces. */
  person?: number;
  /** 0-based page index (frontend convention). */
  page?: number;
  inferred?: boolean;
  orderBy?: "confidence" | "date";
  analysisMethod?: "clustering" | "classification";
  minConfidence?: number;
};

export async function fetchFaces(client: ApiClient, params: FaceListParams = {}): Promise<S.PersonFaceListResponse> {
  const query = buildQuery({
    person: params.person ?? 0,
    page: params.page ?? 0,
    inferred: params.inferred ?? false,
    order_by: params.orderBy ?? "confidence",
    analysis_method: params.analysisMethod,
    min_confidence: params.minConfidence,
  });
  const res = await client.get<unknown>(`/faces/${query}`);
  return parseResponse(S.PersonFaceListResponse, res, "faces");
}

export async function fetchIncompleteFaces(
  client: ApiClient,
  params: { inferred?: boolean; orderBy?: "confidence" | "date"; analysisMethod?: "clustering" | "classification" } = {}
): Promise<S.IncompleteFacesResponse> {
  const query = buildQuery({
    inferred: params.inferred ?? false,
    order_by: params.orderBy ?? "confidence",
    analysis_method: params.inferred ? (params.analysisMethod ?? "clustering") : undefined,
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

export async function trainFaces(client: ApiClient): Promise<S.JobTriggerResponse> {
  const res = await client.post<unknown>("/trainfaces", {});
  return parseResponse(S.JobTriggerResponse, res, "train faces");
}

/* ---- upload / exists --------------------------------------------------- */

export async function existsByHash(client: ApiClient, hashes: string[]): Promise<S.ExistsResponse> {
  const res = await client.post<unknown>("/photosonsale/exists", { hashes } satisfies S.ExistsRequest);
  return parseResponse(S.ExistsResponse, res, "exists check");
}

/* ---- delta sync (mobile-v2, backend api/views/sync.py) ----------------- */

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

export async function syncUserAlbums(client: ApiClient, params: SyncPullParams = {}): Promise<S.SyncUserAlbumsResponse> {
  const res = await client.get<unknown>(`/sync/albums/user/${syncQuery(params)}`);
  return parseResponse(S.SyncUserAlbumsResponse, res, "sync user albums");
}

export async function syncAutoAlbums(client: ApiClient, params: SyncPullParams = {}): Promise<S.SyncAutoAlbumsResponse> {
  const res = await client.get<unknown>(`/sync/albums/auto/${syncQuery(params)}`);
  return parseResponse(S.SyncAutoAlbumsResponse, res, "sync auto albums");
}

export async function syncThingAlbums(client: ApiClient, params: SyncPullParams = {}): Promise<S.SyncThingAlbumsResponse> {
  const res = await client.get<unknown>(`/sync/albums/thing/${syncQuery(params)}`);
  return parseResponse(S.SyncThingAlbumsResponse, res, "sync thing albums");
}

export async function syncPlaceAlbums(client: ApiClient, params: SyncPullParams = {}): Promise<S.SyncPlaceAlbumsResponse> {
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

/** Toggle favorite on a set of photos (favorite = rating ≥ favorite_min_rating). */
export async function setPhotosFavorite(
  client: ApiClient,
  imageHashes: string[],
  favorite: boolean
): Promise<S.BulkPhotoMutationResponse> {
  const res = await client.post<unknown>("/photosedit/favorite/", {
    image_hashes: imageHashes,
    favorite,
  });
  return parseResponse(S.BulkPhotoMutationResponse, res, "set favorite");
}

/** Toggle hidden on a set of photos. */
export async function setPhotosHidden(
  client: ApiClient,
  imageHashes: string[],
  hidden: boolean
): Promise<S.BulkPhotoMutationResponse> {
  const res = await client.post<unknown>("/photosedit/hide/", {
    image_hashes: imageHashes,
    hidden,
  });
  return parseResponse(S.BulkPhotoMutationResponse, res, "set hidden");
}

/** Move photos to / restore from the trashcan (soft delete). */
export async function setPhotosDeleted(
  client: ApiClient,
  imageHashes: string[],
  deleted: boolean
): Promise<S.BulkPhotoMutationResponse> {
  const res = await client.post<unknown>("/photosedit/setdeleted/", {
    image_hashes: imageHashes,
    deleted,
  });
  return parseResponse(S.BulkPhotoMutationResponse, res, "set deleted");
}

/** Set an arbitrary star rating on one photo (keyed by image hash). */
export async function setPhotoRating(
  client: ApiClient,
  imageHash: string,
  rating: number
): Promise<S.PhotoEditResponse> {
  const res = await client.patch<unknown>(`/photos/edit/${imageHash}/`, { rating });
  return parseResponse(S.PhotoEditResponse, res, "set rating");
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

/** Create a user album with an initial photo set (photo ids = UUID pks). */
export async function createUserAlbum(
  client: ApiClient,
  title: string,
  photoIds: string[]
): Promise<S.CreateUserAlbumResponse> {
  const res = await client.post<unknown>("/albums/user/edit/", { title, photos: photoIds });
  return parseResponse(S.CreateUserAlbumResponse, res, "create user album");
}

/** Add photos (by UUID pk) to an existing user album. */
export async function addPhotosToUserAlbum(
  client: ApiClient,
  albumId: number,
  title: string,
  photoIds: string[]
): Promise<unknown> {
  return client.patch(`/albums/user/edit/${albumId}/`, { title, photos: photoIds });
}

/** Remove photos (by image hash) from a user album. */
export async function removePhotosFromUserAlbum(
  client: ApiClient,
  albumId: number,
  imageHashes: string[]
): Promise<unknown> {
  return client.patch(`/albums/user/edit/${albumId}/`, { removedPhotos: imageHashes });
}

/** Rename a user album. */
export async function renameUserAlbum(
  client: ApiClient,
  albumId: number,
  title: string
): Promise<unknown> {
  return client.patch(`/albums/user/${albumId}/`, { title });
}

/** Rename a person. */
export async function renamePerson(
  client: ApiClient,
  personId: number,
  newPersonName: string
): Promise<unknown> {
  return client.patch(`/persons/${personId}/`, { newPersonName });
}
