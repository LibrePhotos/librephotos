import { endpoints, galleryKeys, photoGridKeys } from "@librephotos/api-client";
import type { GalleryFilter, IncompleteDatePhotosGroup, PigPhoto } from "@librephotos/api-client";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { addTempElementsToGroups } from "../../util/util";
import { DATE_ALBUM_PAGE_SIZE, hydrateGroupsFromCachedPages } from "../albums/hooks/useFetchDateAlbumsQuery";
import type { CachedDateAlbumPage } from "../albums/hooks/useFetchDateAlbumsQuery";
import { apiClient } from "../api";

/**
 * The public gallery (#434). Every hook here works without an account; while the gallery is closed
 * to the visitor every request is a 404, which `useGalleryQuery` reports as an error.
 */

/** Whether the gallery is open to me and how much it shows; an error (404) while it is closed. */
export const useGalleryQuery = (enabled = true) =>
  useQuery({
    queryKey: galleryKeys.summary(),
    queryFn: () => endpoints.fetchGallery(apiClient),
    enabled,
    // A closed gallery is a 404: asking again only delays the answer.
    retry: false,
  });

export const useGalleryPlacesQuery = (owner: number | undefined) =>
  useQuery({
    queryKey: galleryKeys.places(owner),
    queryFn: () => endpoints.fetchGalleryPlaces(apiClient, owner),
  });

export const useGalleryPeopleQuery = (owner: number | undefined, enabled = true) =>
  useQuery({
    queryKey: galleryKeys.people(owner),
    queryFn: () => endpoints.fetchGalleryPeople(apiClient, owner),
    enabled,
  });

export const useGalleryPhotographersQuery = () =>
  useQuery({
    queryKey: galleryKeys.photographers(),
    queryFn: () => endpoints.fetchGalleryPhotographers(apiClient),
  });

/** Admin: what opening the gallery would publish, asked only while the confirm is open. */
export const useGalleryPreviewQuery = (enabled: boolean) =>
  useQuery({
    queryKey: galleryKeys.preview(),
    queryFn: () => endpoints.fetchGalleryPreview(apiClient),
    enabled,
    // Asked again each time the confirm opens: users may have opted in meanwhile.
    staleTime: 0,
  });

/** The day pages of `filter`'s timeline already in the cache, still valid. */
function cachedDayPages(queryClient: QueryClient, filter: GalleryFilter): CachedDateAlbumPage[] {
  return queryClient
    .getQueryCache()
    .findAll({ queryKey: photoGridKeys.galleryDayPages(filter) })
    .flatMap(query => {
      const [, , , day, page] = query.queryKey;
      const items = queryClient.getQueryData<PigPhoto[]>(query.queryKey);
      if (query.state.isInvalidated || typeof day !== "number" || typeof page !== "number" || !items) return [];
      return [{ albumDateId: day, page, items }];
    });
}

/**
 * The gallery's timeline under `filter`, as the photo lists lay it out: a placeholder per photo,
 * filled from day pages already loaded (see useFetchDateAlbumsQuery).
 */
export const useGalleryDaysQuery = (filter: GalleryFilter) =>
  useQuery({
    queryKey: photoGridKeys.galleryDays(filter),
    queryFn: async ({ client }) => {
      const days = await endpoints.fetchGalleryDays(apiClient, filter);
      addTempElementsToGroups(days);
      hydrateGroupsFromCachedPages(days, cachedDayPages(client, filter));
      return days;
    },
  });

/** Put one loaded day page into the timeline it belongs to. */
function mergeDayPage(queryClient: QueryClient, filter: GalleryFilter, day: number, page: number, items: PigPhoto[]) {
  queryClient.setQueryData<IncompleteDatePhotosGroup[]>(photoGridKeys.galleryDays(filter), days =>
    days?.map(group => {
      if (group.id !== day) return group;
      const start = (page - 1) * DATE_ALBUM_PAGE_SIZE;
      const merged = [...group.items];
      items.slice(0, Math.max(0, group.numberOfItems - start)).forEach((item, i) => {
        merged[start + i] = item;
      });
      return { ...group, items: merged };
    })
  );
}

/** One page of a day of the gallery's timeline; merged into the timeline when it arrives. */
export const useGalleryDayQuery = (filter: GalleryFilter, day: number, page: number) =>
  useQuery({
    queryKey: photoGridKeys.galleryDay(filter, day, page),
    queryFn: async ({ client }) => {
      const { results } = await endpoints.fetchGalleryDayPhotos(apiClient, day, page, filter);
      mergeDayPage(client, filter, day, page, results);
      return results;
    },
    enabled: day > 0,
  });
