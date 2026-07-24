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

/* ---- jobs -------------------------------------------------------------- */

export async function fetchJobs(client: ApiClient): Promise<S.JobsResponse> {
  const res = await client.get<unknown>("/jobs/");
  return parseResponse(S.JobsResponse, res, "jobs");
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
