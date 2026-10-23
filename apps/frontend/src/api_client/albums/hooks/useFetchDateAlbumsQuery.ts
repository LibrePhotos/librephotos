import {
  endpoints,
  photoGridKeys,
  Photoset,
  type DateAlbumFilter,
  type DateAlbumsListKey,
} from "@librephotos/api-client";
import type { IncompleteDatePhotosGroup, MediaType, PhotoOrder, PigPhoto } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import {
  timelineFilterKey,
  timelineFilterToBulkQuery,
  type TimelineFilter,
} from "../../../components/photolist/timelineFilter";
import { addTempElementsToGroups } from "../../../util/util";
import { apiClient, queryClient } from "../../api";
import { usePhotoOrder } from "../../user/hooks/usePhotoOrder";

export const DATE_ALBUM_PAGE_SIZE = 100;

// A page of a single date album that is already in the query cache:
// `/albums/date/<id>/?page=<n>` for the same photoset / person / user /
// folder / media-type / timeline filter as the list being loaded.
export type CachedDateAlbumPage<T = PigPhoto> = {
  albumDateId: number;
  page: number;
  items: T[];
};

type HydratableGroup<T> = Pick<IncompleteDatePhotosGroup, "id" | "numberOfItems"> & { items: T[] };

// Replaces the temp placeholders of `groups` with photos from pages of the
// same date album that the per-day query already loaded. Only pages whose
// data is not invalidated are passed in, so a refetch of the list (after an
// upload, a rotation, ...) keeps showing the day pages that are still
// current instead of dropping back to blank placeholders that nothing
// re-requests. Pages resolved later merge into the list cache themselves
// (see useFetchDateAlbumQuery), so the two refetches can finish in any order.
export function hydrateGroupsFromCachedPages<T>(groups: HydratableGroup<T>[], pages: CachedDateAlbumPage<T>[]) {
  pages.forEach(({ albumDateId, page, items }) => {
    const group = groups.find(g => g.id === albumDateId);
    if (!group || page < 1) return;
    const start = (page - 1) * DATE_ALBUM_PAGE_SIZE;
    // Never grow a group past the count the server just reported: a stale
    // page from before a deletion could otherwise resurrect photos.
    const end = Math.min(start + items.length, group.numberOfItems);
    for (let i = start; i < end; i++) {
      const item = items[i - start];
      if (item === undefined) continue;
      group.items[i] = item;
    }
  });
}

// Whether a day query (photoGridKeys.dateAlbumDay: ["photoGrid", "dateAlbum", photoset, day id, page,
// ...the list's filters]) was asked under the same filters as the list `listKey`: person, user,
// folder, media type, timeline filter and, for a shared library's lists (#2731), whose days.
function sameFilters(queryKey: readonly unknown[], listKey: DateAlbumsListKey): boolean {
  const asked = queryKey.slice(5);
  const filters = listKey.slice(1);
  return asked.length === filters.length && filters.every((value, i) => asked[i] === value);
}

// Collects the still-valid, already-loaded pages of every date album that
// belongs to the list identified by `listKey` (see useFetchDateAlbumQuery for
// the per-day query key layout).
function getCachedDateAlbumPages(listKey: DateAlbumsListKey): CachedDateAlbumPage[] {
  return queryClient
    .getQueryCache()
    .findAll({ queryKey: photoGridKeys.dateAlbumDays(listKey[0]) })
    .flatMap(query => {
      const [, , , albumDateId, page] = query.queryKey;
      // useFetchDateAlbumQuery is the only query under this key, and it caches the day's group.
      const data = queryClient.getQueryData<IncompleteDatePhotosGroup>(query.queryKey);
      if (
        query.state.isInvalidated ||
        typeof albumDateId !== "number" ||
        typeof page !== "number" ||
        !data?.items ||
        !sameFilters(query.queryKey, listKey)
      ) {
        return [];
      }
      return [{ albumDateId, page, items: data.items }];
    });
}

// Maps the active Photoset plus an optional, independent media-type filter onto
// the backend's boolean filters (sent as "true", or left out). photosetType picks
// the surface (favorites, videos, screenshots, ...); mediaType is the per-view
// All/Photos/Videos/Screenshots/Documents filter that layers on top (e.g. a person
// album filtered to screenshots), so each media flag reacts to either source.
export function buildDateAlbumFilter(photosetType: Photoset, mediaType?: MediaType): DateAlbumFilter {
  return {
    favorite: Photoset.FAVORITES === photosetType || undefined,
    public: Photoset.PUBLIC === photosetType || undefined,
    hidden: Photoset.HIDDEN === photosetType || undefined,
    archived: Photoset.ARCHIVED === photosetType || undefined,
    in_trashcan: Photoset.IN_TRASHCAN === photosetType || undefined,
    photo: Photoset.PHOTOS === photosetType || mediaType === "photos" || undefined,
    video: Photoset.VIDEOS === photosetType || mediaType === "videos" || undefined,
    is_screenshot: Photoset.SCREENSHOTS === photosetType || mediaType === "screenshots" || undefined,
    is_document: Photoset.DOCUMENTS === photosetType || mediaType === "documents" || undefined,
  };
}

// Define the parameter types for the queries
type AlbumDateListOptions = {
  photosetType: Photoset;
  person_id?: number;
  username?: string;
  folder?: string;
  // Optional media-type filter, independent of photosetType (e.g. a person
  // album filtered to videos). Combines with photosetType for photo/video.
  mediaType?: MediaType;
  // The main timeline's filter, already resolved against the user's saved
  // default (see components/photolist/timelineFilter.ts). Only "/" sets it.
  timelineFilter?: TimelineFilter;
  // A library shared with me (#2731): that owner's days instead of mine.
  library?: number;
  // My timeline with the libraries I show in it (#2731). Only "/" sets it.
  withLibraries?: boolean;
  // Newest or oldest day first (#2712); the hooks fill it in from the user's photo order.
  order?: PhotoOrder;
};

// Whose days a list holds, for its key: left out for my own library alone.
function libraryKey(options: AlbumDateListOptions): string | undefined {
  if (options.library !== undefined) return `library:${options.library}`;
  return options.withLibraries ? "libraries" : undefined;
}

// Everything the list and its day pages filter by. The timeline filter only
// adds what it turns on, so it never clears the photoset's `favorite`.
export function dateAlbumRequestFilter(options: AlbumDateListOptions): DateAlbumFilter {
  return {
    ...buildDateAlbumFilter(options.photosetType, options.mediaType),
    ...(options.timelineFilter ? timelineFilterToBulkQuery(options.timelineFilter) : {}),
    person: options.person_id,
    username: options.username,
    folder: options.folder,
    library: options.library,
    libraries: options.withLibraries,
    order: options.order,
  };
}

// The list's query key; useFetchDateAlbumQuery merges its pages into it.
export function dateAlbumsListKey(options: AlbumDateListOptions): DateAlbumsListKey {
  const library = libraryKey(options);
  const key: DateAlbumsListKey = [
    options.photosetType,
    options.person_id,
    options.username,
    options.folder,
    options.mediaType ?? "all",
    timelineFilterKey(options.timelineFilter),
  ];
  // Only when set, so the keys of my own newest-first lists stay as they were.
  if (library !== undefined) key.push(library);
  if (options.order === "oldest") key.push("order:oldest");
  return key;
}

// Fetch date albums
// In the user's photo order (#2712), and only once it is known, so a list never loads in the
// other order first.
export const useFetchDateAlbumsQuery = (listOptions: AlbumDateListOptions, queryOptions?: { skip?: boolean }) => {
  const photoOrder = usePhotoOrder();
  const options = { ...listOptions, order: photoOrder.order };
  return useQuery({
    queryKey: photoGridKeys.dateAlbumList(dateAlbumsListKey(options)),
    queryFn: async () => {
      const results = await endpoints.fetchDateAlbumsList(apiClient, dateAlbumRequestFilter(options));

      addTempElementsToGroups(results);
      hydrateGroupsFromCachedPages(results, getCachedDateAlbumPages(dateAlbumsListKey(options)));
      return results;
    },
    enabled: !queryOptions?.skip && photoOrder.ready,
  });
};
