import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as endpoints from "../endpoints";
import { Photoset } from "../schemas";
import type { LoginPost } from "../schemas";
import { useApiClient } from "./context";
import { queryKeys } from "./queryKeys";

export { ApiClientProvider, useApiClient } from "./context";
export { queryKeys } from "./queryKeys";

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

export function useLogoutMutation(options?: { getRefreshToken: () => Promise<string | null> | string | null; onSuccess?: () => void }) {
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
    queryKey: queryKeys.userSelfDetails(userId ?? ""),
    queryFn: () => endpoints.fetchUserSelfDetails(client, userId!),
    enabled: userId !== undefined && userId !== "",
  });
}

export function useUserListQuery() {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.userList(),
    queryFn: () => endpoints.fetchUserList(client),
  });
}

/* ---- timeline (date albums) ------------------------------------------- */

export function useDateAlbumsQuery(photoset: Photoset = Photoset.TIMESTAMP) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.dateAlbums(photoset),
    queryFn: () => endpoints.fetchDateAlbumsList(client, endpoints.photosetToFilter(photoset)),
  });
}

export function useDateAlbumQuery(
  photoset: Photoset,
  albumDateId: string,
  page: number,
  options?: { enabled?: boolean }
) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.dateAlbum(photoset, albumDateId, page),
    queryFn: () => endpoints.fetchDateAlbum(client, albumDateId, page, endpoints.photosetToFilter(photoset)),
    enabled: options?.enabled ?? true,
  });
}

/* ---- photos ------------------------------------------------------------ */

export function useRecentlyAddedPhotosQuery() {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.recentlyAddedPhotos(),
    queryFn: () => endpoints.fetchRecentlyAddedPhotos(client),
  });
}

export function usePhotoDetailsQuery(imageHash: string | undefined) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.photoDetails(imageHash ?? ""),
    queryFn: () => endpoints.fetchPhotoDetails(client, imageHash!),
    enabled: !!imageHash,
  });
}

/* ---- albums ------------------------------------------------------------ */

export function useUserAlbumsQuery() {
  const client = useApiClient();
  return useQuery({ queryKey: queryKeys.userAlbums(), queryFn: () => endpoints.fetchUserAlbumsList(client) });
}

export function useAutoAlbumsQuery() {
  const client = useApiClient();
  return useQuery({ queryKey: queryKeys.autoAlbums(), queryFn: () => endpoints.fetchAutoAlbumsList(client) });
}

export function useThingAlbumsQuery() {
  const client = useApiClient();
  return useQuery({ queryKey: queryKeys.thingAlbums(), queryFn: () => endpoints.fetchThingAlbumsList(client) });
}

export function usePlaceAlbumsQuery() {
  const client = useApiClient();
  return useQuery({ queryKey: queryKeys.placeAlbums(), queryFn: () => endpoints.fetchPlaceAlbumsList(client) });
}

/* ---- persons ----------------------------------------------------------- */

export function usePeopleAlbumsQuery() {
  const client = useApiClient();
  return useQuery({ queryKey: queryKeys.peopleAlbums(), queryFn: () => endpoints.fetchPeopleAlbums(client) });
}

/* ---- search ------------------------------------------------------------ */

export function useSearchPhotosQuery(searchTerm: string, semantic = false) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.searchPhotos(searchTerm),
    queryFn: () => endpoints.searchPhotos(client, searchTerm, semantic),
    enabled: searchTerm.length > 0,
  });
}

/* ---- settings / jobs --------------------------------------------------- */

export function useSiteSettingsQuery() {
  const client = useApiClient();
  return useQuery({ queryKey: queryKeys.siteSettings(), queryFn: () => endpoints.fetchSiteSettings(client) });
}

export function useJobsQuery() {
  const client = useApiClient();
  return useQuery({ queryKey: queryKeys.jobs(), queryFn: () => endpoints.fetchJobs(client) });
}
