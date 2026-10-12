import { z } from "zod";
import * as S from "../schemas";
import { Photoset } from "../schemas";
import { runningJobId } from "../transport/client";
import { fetchAllPages } from "../transport/pages";
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
  in_trashcan?: boolean;
  photo?: boolean;
  video?: boolean;
  is_screenshot?: boolean;
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
    in_trashcan: photoset === Photoset.IN_TRASHCAN || undefined,
    photo: photoset === Photoset.PHOTOS || undefined,
    video: photoset === Photoset.VIDEOS || undefined,
    is_screenshot: photoset === Photoset.SCREENSHOTS || undefined,
  };
}

/** The date-album query params: each flag is "true" or left out, and buildQuery drops a blank value. */
function dateAlbumParams(filter: DateAlbumFilter) {
  return {
    favorite: filter.favorite ? "true" : undefined,
    public: filter.public ? "true" : undefined,
    hidden: filter.hidden ? "true" : undefined,
    in_trashcan: filter.in_trashcan ? "true" : undefined,
    photo: filter.photo ? "true" : undefined,
    video: filter.video ? "true" : undefined,
    is_screenshot: filter.is_screenshot ? "true" : undefined,
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

/** The media-type filter album detail views accept (`?photo=true` etc.). */
export type AlbumMediaFilter = {
  photo?: boolean;
  video?: boolean;
  is_screenshot?: boolean;
};

function albumMediaQuery(filter: AlbumMediaFilter) {
  return {
    photo: filter.photo ? "true" : undefined,
    video: filter.video ? "true" : undefined,
    is_screenshot: filter.is_screenshot ? "true" : undefined,
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
export async function fetchPublicAlbum(client: ApiClient, slug: string): Promise<S.UserAlbum> {
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

/** Photo grid (grouped by date) for one tag album. */
export async function fetchTagAlbum(client: ApiClient, id: number | string): Promise<S.TagAlbum> {
  const res = await client.get<unknown>(`/tags/${id}/`);
  return parseResponse(S.TagAlbumResponse, res, "tag album detail").results;
}

/* ---- persons ----------------------------------------------------------- */

/** Every person, all pages; `pageSize` asks for bigger pages (the server allows up to 1000). */
export async function fetchPeopleAlbums(client: ApiClient, options: { pageSize?: number } = {}): Promise<S.PersonList> {
  const results = await fetchAllPages(client, `/persons/${buildQuery({ page_size: options.pageSize })}`);
  return parseResponse(S.FetchPeopleAlbumsResponse, { results }, "people albums").results;
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
  const res = await client.get<unknown>("/sitesettings");
  return parseResponse(S.SiteSettings, res, "site settings");
}

/** Admin: change site settings (only the keys sent); answers the settings as GET does. */
export async function updateSiteSettings(
  client: ApiClient,
  settings: Partial<S.SiteSettings>
): Promise<S.SiteSettings> {
  const res = await client.post<unknown>("/sitesettings", settings);
  return parseResponse(S.SiteSettings, res, "update site settings");
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

export async function fetchJobs(client: ApiClient, page = 1, pageSize = 20): Promise<S.JobsResponse> {
  const res = await client.get<unknown>(`/jobs/${buildQuery({ page, page_size: pageSize })}`);
  return parseResponse(S.JobsResponse, res, "jobs");
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
async function triggerJob(client: ApiClient, endpoint: string, context: string): Promise<S.JobTriggerResponse> {
  try {
    const res = await client.post<unknown>(endpoint, {});
    return parseResponse(S.JobTriggerResponse, res, context);
  } catch (error) {
    const jobId = runningJobId(error);
    if (jobId === null) throw error;
    return { status: true, job_id: jobId, already_running: true };
  }
}

/** Trigger an incremental library scan. Returns the queued (or already running) job id. */
export async function scanPhotos(client: ApiClient): Promise<S.JobTriggerResponse> {
  return triggerJob(client, "/scanphotos/", "scan photos");
}

/** Trigger a full library rescan. */
export async function fullScanPhotos(client: ApiClient): Promise<S.JobTriggerResponse> {
  return triggerJob(client, "/fullscanphotos/", "full scan photos");
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

/* ---- public links ------------------------------------------------------ */

/** Make photos public (creates their public-gallery visibility) or private. */
export async function setPhotosPublic(client: ApiClient, imageHashes: string[], isPublic: boolean): Promise<unknown> {
  return client.post("/photosedit/makepublic/", {
    image_hashes: imageHashes,
    val_public: isPublic,
  });
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
  orderBy?: "confidence" | "date";
  analysisMethod?: "clustering" | "classification";
  minConfidence?: number;
};

export async function fetchFaces(client: ApiClient, params: FaceListParams = {}): Promise<S.PersonFaceListResponse> {
  const query = buildQuery({
    person: params.person ?? 0,
    page: params.page ?? 1,
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
  return triggerJob(client, "/trainfaces", "train faces");
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

/**
 * Set a 0–5 star rating on one photo (keyed by image hash).
 *
 * `/photosedit/rating/` is the favorite toggle's sibling (the web app has no
 * star row, so only mobile calls it): owner-scoped, bumps the photo's
 * `last_modified` so the next delta pull carries the rating, and writes it to
 * the file or sidecar when the user syncs metadata to disk. Not
 * `PATCH /photos/edit/{hash}/`: that endpoint ignores `rating` and still
 * answers 200, so every rating was silently dropped.
 */
export async function setPhotoRating(
  client: ApiClient,
  imageHash: string,
  rating: number
): Promise<S.BulkPhotoMutationResponse> {
  const res = await client.post<unknown>("/photosedit/rating/", {
    image_hashes: [imageHash],
    rating,
  });
  return parseResponse(S.BulkPhotoMutationResponse, res, "set rating");
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

/** Delete one event album. Answers 204. */
export async function deleteAutoAlbum(client: ApiClient, albumId: number | string): Promise<void> {
  await client.delete(`/albums/auto/${albumId}/`);
}

/** Delete every event album of the user. The server answers the string "success". */
export async function deleteAllAutoAlbums(client: ApiClient): Promise<string> {
  const res = await client.post<unknown>("/albums/auto/delete_all/");
  return parseResponse(z.string(), res, "delete all event albums");
}
