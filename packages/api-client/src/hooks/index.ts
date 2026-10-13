import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as endpoints from "../endpoints";
import { pollWhile } from "../polling";
import { Photoset } from "../schemas";
import type { JobsResponse, LoginPost, WorkerAvailabilityResponse } from "../schemas";
import type { ApiClient } from "../transport/types";
import { useApiClient } from "./context";
import {
  albumKeys,
  faceKeys,
  jobKeys,
  NO_TIMELINE_FILTER,
  photoGridKeys,
  photoKeys,
  settingsKeys,
  tagKeys,
  userKeys,
  type DateAlbumsListKey,
} from "./queryKeys";

export { ApiClientProvider, useApiClient } from "./context";
export * from "./queryKeys";

/** Whether a query has the id it loads: an id that is not missing or empty. */
function hasId(id: string | number | undefined): id is string | number {
  return id !== undefined && id !== "";
}

// A query below is only enabled with the id it loads, so its queryFn throws without one (it then
// only runs when a caller refetches a disabled query).
function missing(what: string): Error {
  return new Error(`No ${what} to load`);
}

/* ---- auth -------------------------------------------------------------- */

export function useLoginMutation(options?: { onSuccess?: () => void }) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (credentials: LoginPost) => endpoints.login(client, credentials),
    onSuccess: () => {
      queryClient.invalidateQueries();
      options?.onSuccess?.();
    },
  });
}

export function useLogoutMutation(options?: {
  getRefreshToken: () => Promise<string | null> | string | null;
  onSuccess?: () => void;
}) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const refresh = options ? await options.getRefreshToken() : null;
      if (refresh) await endpoints.logout(client, refresh);
    },
    onSuccess: () => {
      queryClient.clear();
      options?.onSuccess?.();
    },
  });
}

/* ---- user -------------------------------------------------------------- */

export function useUserSelfDetailsQuery(userId: string | number | undefined) {
  const client = useApiClient();
  return useQuery({
    queryKey: userKeys.selfDetail(userId ?? ""),
    queryFn: () => {
      if (!hasId(userId)) throw missing("user");
      return endpoints.fetchUserSelfDetails(client, userId);
    },
    enabled: hasId(userId),
  });
}

export function useUserListQuery() {
  const client = useApiClient();
  return useQuery({
    queryKey: userKeys.list(),
    queryFn: () => endpoints.fetchUserList(client),
  });
}

/* ---- timeline (date albums) ------------------------------------------- */

/** A photoset's list key without the web's person, user, folder, media and timeline filters. */
function unfilteredDateAlbums(photoset: Photoset): DateAlbumsListKey {
  return [photoset, undefined, undefined, undefined, "all", NO_TIMELINE_FILTER];
}

export function useDateAlbumsQuery(photoset: Photoset = Photoset.TIMESTAMP) {
  const client = useApiClient();
  return useQuery({
    queryKey: photoGridKeys.dateAlbumListRaw(photoset),
    queryFn: () => endpoints.fetchDateAlbumsList(client, endpoints.photosetToFilter(photoset)),
  });
}

export function useDateAlbumQuery(
  photoset: Photoset,
  albumDateId: number,
  page: number,
  options?: { enabled?: boolean }
) {
  const client = useApiClient();
  return useQuery({
    queryKey: photoGridKeys.dateAlbumDay(unfilteredDateAlbums(photoset), albumDateId, page),
    queryFn: () => endpoints.fetchDateAlbum(client, albumDateId, page, endpoints.photosetToFilter(photoset)),
    enabled: options?.enabled ?? true,
  });
}

/* ---- photos ------------------------------------------------------------ */

export function useRecentlyAddedPhotosQuery() {
  const client = useApiClient();
  return useQuery({
    // The web's unfiltered view: the same answer under the same key.
    queryKey: photoGridKeys.recentlyAddedView("all"),
    queryFn: () => endpoints.fetchRecentlyAddedPhotos(client),
  });
}

export function usePhotoDetailsQuery(imageHash: string | undefined) {
  const client = useApiClient();
  return useQuery({
    queryKey: photoKeys.detail(imageHash ?? ""),
    queryFn: () => {
      if (!imageHash) throw missing("photo");
      return endpoints.fetchPhotoDetails(client, imageHash);
    },
    enabled: !!imageHash,
  });
}

/* ---- albums ------------------------------------------------------------ */

export function useUserAlbumsQuery() {
  const client = useApiClient();
  return useQuery({ queryKey: albumKeys.userAlbums(), queryFn: () => endpoints.fetchUserAlbumsList(client) });
}

export function useAutoAlbumsQuery() {
  const client = useApiClient();
  return useQuery({ queryKey: albumKeys.autoAlbums(), queryFn: () => endpoints.fetchAutoAlbumsList(client) });
}

export function useThingAlbumsQuery() {
  const client = useApiClient();
  return useQuery({ queryKey: albumKeys.thingsAlbums(), queryFn: () => endpoints.fetchThingAlbumsList(client) });
}

export function usePlaceAlbumsQuery() {
  const client = useApiClient();
  return useQuery({ queryKey: albumKeys.placesAlbums(), queryFn: () => endpoints.fetchPlaceAlbumsList(client) });
}

export function useTagAlbumsQuery() {
  const client = useApiClient();
  return useQuery({ queryKey: tagKeys.list(), queryFn: () => endpoints.fetchTagAlbumsList(client) });
}

export function useThingAlbumQuery(id: string | number | undefined) {
  const client = useApiClient();
  return useQuery({
    queryKey: photoGridKeys.thingsAlbum(String(id ?? ""), "all"),
    queryFn: () => {
      if (!hasId(id)) throw missing("thing album");
      return endpoints.fetchThingAlbum(client, id);
    },
    enabled: hasId(id),
  });
}

export function usePlaceAlbumQuery(id: string | number | undefined) {
  const client = useApiClient();
  return useQuery({
    queryKey: photoGridKeys.placeAlbum(String(id ?? ""), "all"),
    queryFn: () => {
      if (!hasId(id)) throw missing("place album");
      return endpoints.fetchPlaceAlbum(client, id);
    },
    enabled: hasId(id),
  });
}

export function useTagAlbumQuery(id: string | number | undefined) {
  const client = useApiClient();
  return useQuery({
    queryKey: photoGridKeys.tagAlbumView(String(id ?? ""), "all"),
    queryFn: () => {
      if (!hasId(id)) throw missing("tag album");
      return endpoints.fetchTagAlbum(client, id);
    },
    enabled: hasId(id),
  });
}

export function usePhotosWithoutTimestampQuery(page: number) {
  const client = useApiClient();
  return useQuery({
    queryKey: photoGridKeys.withoutTimestamp(page, "all"),
    queryFn: () => endpoints.fetchPhotosWithoutTimestamp(client, page),
  });
}

/* ---- persons ----------------------------------------------------------- */

export function usePeopleAlbumsQuery() {
  const client = useApiClient();
  return useQuery({ queryKey: albumKeys.peopleAlbumsRaw(), queryFn: () => endpoints.fetchPeopleAlbums(client) });
}

/* ---- search ------------------------------------------------------------ */

/** A photo search. A semantic search answers with a flat list, a plain one with date groups. */
export function searchPhotosQueryOptions(client: ApiClient, searchTerm: string, semantic = false) {
  return queryOptions({
    queryKey: photoGridKeys.search(searchTerm, "all", semantic ? "semantic" : "grouped"),
    queryFn: () => endpoints.searchPhotos(client, searchTerm, semantic),
    enabled: searchTerm.length > 0,
  });
}

export function useSearchPhotosQuery(searchTerm: string, semantic = false) {
  const client = useApiClient();
  return useQuery(searchPhotosQueryOptions(client, searchTerm, semantic));
}

/* ---- settings / jobs --------------------------------------------------- */

export function useSiteSettingsQuery() {
  const client = useApiClient();
  return useQuery({ queryKey: settingsKeys.site(), queryFn: () => endpoints.fetchSiteSettings(client) });
}

/** The job list's cadence: active only while a job on the page is unfinished; idle otherwise, so a job that starts elsewhere is still picked up. */
export const jobListRefetchInterval = pollWhile<JobsResponse>(page => page.results.some(job => !job.finished));

/**
 * The job list. It polls at the active cadence only while a job on the page is unfinished. Pass
 * `enabled: false` to stop it (offline).
 */
export function jobsQueryOptions(
  client: ApiClient,
  options: { page?: number; pageSize?: number; enabled?: boolean } = {}
) {
  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? 20;
  return queryOptions({
    queryKey: jobKeys.list({ page, pageSize }),
    queryFn: () => endpoints.fetchJobs(client, page, pageSize),
    refetchInterval: jobListRefetchInterval,
    enabled: options.enabled ?? true,
  });
}

export function useJobsQuery(options?: { page?: number; pageSize?: number; enabled?: boolean }) {
  const client = useApiClient();
  return useQuery(jobsQueryOptions(client, options));
}

/** The worker's cadence: active while the worker is busy, idle otherwise. */
export const workerRefetchInterval = pollWhile<WorkerAvailabilityResponse>(worker => !worker.queue_can_accept_job);

/**
 * The worker's availability. It polls on `workerRefetchInterval`. Pass `enabled: false` to stop it
 * (offline).
 */
export function workerAvailabilityQueryOptions(client: ApiClient, options: { enabled?: boolean } = {}) {
  return queryOptions({
    queryKey: jobKeys.worker(),
    queryFn: () => endpoints.fetchWorkerAvailability(client),
    refetchInterval: workerRefetchInterval,
    enabled: options.enabled ?? true,
  });
}

export function useWorkerAvailabilityQuery(options?: { enabled?: boolean }) {
  const client = useApiClient();
  return useQuery(workerAvailabilityQueryOptions(client, options));
}

/* ---- sharing ----------------------------------------------------------- */

export function useSharedPhotosByMeQuery(enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: photoGridKeys.sharedByMeRaw(),
    queryFn: () => endpoints.fetchSharedPhotosByMe(client),
    enabled,
  });
}

export function useSharedPhotosWithMeQuery(enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: photoGridKeys.sharedWithMeRaw(),
    queryFn: () => endpoints.fetchSharedPhotosWithMe(client),
    enabled,
  });
}

export function useSharedAlbumsByMeQuery(enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: albumKeys.sharedByMeRaw(),
    queryFn: () => endpoints.fetchSharedAlbumsByMe(client),
    enabled,
  });
}

export function useSharedAlbumsWithMeQuery(enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: albumKeys.sharedWithMeRaw(),
    queryFn: () => endpoints.fetchSharedAlbumsWithMe(client),
    enabled,
  });
}

/* ---- faces ------------------------------------------------------------- */

export function useFacesQuery(params: { person?: number; inferred?: boolean; page?: number } = {}, enabled = true) {
  const client = useApiClient();
  // Only the values in the key go to the request (fetchFaces has the same defaults).
  const { person = 0, inferred = false, page = 1 } = params;
  return useQuery({
    queryKey: faceKeys.personFacePageRaw({ person, inferred, page }),
    queryFn: () => endpoints.fetchFaces(client, { person, inferred, page }),
    enabled,
  });
}

export function useIncompleteFacesQuery(inferred = false, enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: faceKeys.incompleteListRaw(inferred),
    queryFn: () => endpoints.fetchIncompleteFaces(client, { inferred }),
    enabled,
  });
}
