import { useQuery } from "@tanstack/react-query";
import { type MediaType } from "../../../components/photolist/mediaTypeFilter";
import { addTempElementsToGroups } from "../../../util/util";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient, queryClient } from "../../api";
import { IncompleteDatePhotosGroup, Photoset, PigPhoto } from "../../photos/types";
import { FetchDateAlbumsListResponse } from "../types";
import { DateAlbumQueryKeys } from "./useFetchDateAlbumQuery";

export const DateAlbumsQueryKeys = ["dateAlbums"] as const;

export const DATE_ALBUM_PAGE_SIZE = 100;

// A page of a single date album that is already in the query cache:
// `/albums/date/<id>?page=<n>` for the same photoset / person / user /
// folder / media-type filter as the list being loaded.
export type CachedDateAlbumPage<T = PigPhoto> = {
  albumDateId: string;
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
      group.items[i] = items[i - start];
    }
  });
}

type DateAlbumsListKey = [
  photosetType: Photoset,
  person_id: number | undefined,
  username: string | undefined,
  folder: string | undefined,
  mediaType: MediaType | "all",
];

// Collects the still-valid, already-loaded pages of every date album that
// belongs to the list identified by `listKey` (see useFetchDateAlbumQuery for
// the per-day query key layout).
function getCachedDateAlbumPages<T>(listKey: DateAlbumsListKey): CachedDateAlbumPage<T>[] {
  const [photosetType, personId, username, folder, mediaType] = listKey;
  return queryClient
    .getQueryCache()
    .findAll({ queryKey: [...DateAlbumQueryKeys, photosetType] })
    .flatMap(query => {
      const [, , albumDateId, page, qPersonId, qUsername, qFolder, qMediaType] = query.queryKey as [
        string,
        Photoset,
        string,
        number,
        number | undefined,
        string | undefined,
        string | undefined,
        MediaType | "all",
      ];
      const data = query.state.data as { items?: T[] } | undefined;
      if (
        query.state.isInvalidated ||
        !data?.items ||
        qPersonId !== personId ||
        qUsername !== username ||
        qFolder !== folder ||
        qMediaType !== mediaType
      ) {
        return [];
      }
      return [{ albumDateId, page, items: data.items }];
    });
}

// The backend's boolean date-album filter params: each is either the string
// "true" or omitted (undefined).
export type DateAlbumFilterParams = {
  favorite?: "true";
  public?: "true";
  hidden?: "true";
  in_trashcan?: "true";
  photo?: "true";
  video?: "true";
  is_screenshot?: "true";
};

// Maps the active Photoset plus an optional, independent media-type filter onto
// the backend's boolean query params. photosetType picks the surface (favorites,
// videos, screenshots, ...); mediaType is the per-view All/Photos/Videos/
// Screenshots toggle that layers on top (e.g. a person album filtered to
// screenshots), so photo/video/is_screenshot react to either source.
export function buildDateAlbumFilterParams(photosetType: Photoset, mediaType?: MediaType): DateAlbumFilterParams {
  return {
    favorite: Photoset.FAVORITES === photosetType ? "true" : undefined,
    public: Photoset.PUBLIC === photosetType ? "true" : undefined,
    hidden: Photoset.HIDDEN === photosetType ? "true" : undefined,
    in_trashcan: Photoset.IN_TRASHCAN === photosetType ? "true" : undefined,
    photo: Photoset.PHOTOS === photosetType || mediaType === "photos" ? "true" : undefined,
    video: Photoset.VIDEOS === photosetType || mediaType === "videos" ? "true" : undefined,
    is_screenshot: Photoset.SCREENSHOTS === photosetType || mediaType === "screenshots" ? "true" : undefined,
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
};

// Fetch date albums
export const useFetchDateAlbumsQuery = (options: AlbumDateListOptions) => {
  const listKey: DateAlbumsListKey = [
    options.photosetType,
    options.person_id,
    options.username,
    options.folder,
    options.mediaType ?? "all",
  ];
  return useQuery({
    queryKey: [...DateAlbumsQueryKeys, ...listKey],
    queryFn: async () => {
      const params = {
        ...buildDateAlbumFilterParams(options.photosetType, options.mediaType),
        person: options.person_id,
        username: options.username?.toLowerCase(),
        folder: options.folder,
      };

      const response = await fetchClient.get(
        `/albums/date/list/?${new URLSearchParams(
          Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][]
        ).toString()}`
      );

      const parsed = parseWithNotification(FetchDateAlbumsListResponse, response, "Failed to load photo groups");
      const { results } = parsed;

      addTempElementsToGroups(results);
      hydrateGroupsFromCachedPages(
        results,
        getCachedDateAlbumPages<(typeof results)[number]["items"][number]>(listKey)
      );
      return results;
    },
  });
};
