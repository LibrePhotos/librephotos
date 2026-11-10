import { endpoints, photoGridKeys } from "@librephotos/api-client";
import type {
  DateAlbumsListKey,
  DayPhotosPage,
  IncompleteDatePhotosGroup,
  PhotoOrder,
  PigPhoto,
} from "@librephotos/api-client";
import { useQueries, useQueryClient, type Query, type QueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { PigVisibleGroup } from "../../../components/photolist/PhotoListView";
import { useDayPagesOnScreen } from "../../../components/photolist/visibleDayPages";
import { apiClient, ApiError } from "../../api";
import { usePhotoOrder } from "../../user/hooks/usePhotoOrder";
import { dayLayoutQuery, ensureDayLayout } from "./dateAlbumLayout";
import {
  DATE_ALBUM_PAGE_SIZE,
  dateAlbumRequestFilter,
  dateAlbumsListKey,
  type AlbumDateListOptions,
} from "./useFetchDateAlbumsQuery";

/** A day's request options: the list's filters, the day and the photo order (#2712). */
type DayRequest = AlbumDateListOptions & { album_date_id: number; order: PhotoOrder };

/**
 * The `after` of page `page` of a day: null for the first, the previous page's `next` when that page
 * is loaded and current, else the day's layout. Undefined for a page past the end of the day.
 */
async function pageCursor(queryClient: QueryClient, day: DayRequest, page: number): Promise<string | null | undefined> {
  if (page <= 1) return null;
  const previousKey = photoGridKeys.dateAlbumDay(dateAlbumsListKey(day), day.album_date_id, page - 1);
  const previous = queryClient.getQueryState<DayPhotosPage>(previousKey);
  if (previous?.data && !previous.isInvalidated) return previous.data.next ?? undefined;
  const layout = await queryClient.fetchQuery(
    dayLayoutQuery(dateAlbumsListKey(day), day.album_date_id, dateAlbumRequestFilter(day))
  );
  return layout.page_after[page - 1];
}

const isStaleCursor = (error: unknown) => error instanceof ApiError && error.status === 400;

/**
 * Page `page` of a day: the cursor that opens it, then its photos. A cursor whose photo left the
 * day since (a 400) is looked up again once in a fresh layout.
 */
async function fetchDayPage(queryClient: QueryClient, day: DayRequest, page: number): Promise<DayPhotosPage> {
  const read = async () => {
    const after = await pageCursor(queryClient, day, page);
    if (after === undefined) return { items: [], next: null };
    return endpoints.fetchDayPhotos(
      apiClient,
      day.album_date_id,
      after,
      dateAlbumRequestFilter(day),
      DATE_ALBUM_PAGE_SIZE
    );
  };
  try {
    return await read();
  } catch (error) {
    if (!isStaleCursor(error) || page <= 1) throw error;
    const listKey = dateAlbumsListKey(day);
    await queryClient.invalidateQueries({
      queryKey: photoGridKeys.dateAlbumLayout(listKey, day.album_date_id),
      refetchType: "none",
    });
    queryClient.removeQueries({
      queryKey: photoGridKeys.dateAlbumDay(listKey, day.album_date_id, page - 1),
      exact: true,
    });
    return read();
  }
}

/** Put a loaded page of a day into the day's placeholders in the list cache. */
function mergeDayPage(
  queryClient: QueryClient,
  listKey: DateAlbumsListKey,
  dayId: number,
  page: number,
  items: DayPhotosPage["items"]
) {
  queryClient.setQueryData<IncompleteDatePhotosGroup[]>(photoGridKeys.dateAlbumList(listKey), groups =>
    groups?.map(group => {
      if (group.id !== dayId) return group;
      const start = (page - 1) * DATE_ALBUM_PAGE_SIZE;
      const merged = group.items.slice();
      // Never grow a day past the count the list reported: a page read after a deletion has fewer.
      items.slice(0, Math.max(0, group.numberOfItems - start)).forEach((item, i) => {
        merged[start + i] = item;
      });
      return { ...group, items: merged };
    })
  );
}

/** One page of a day, in the same photo order (#2712) as the day list it fills in. */
function dayPageQuery(day: DayRequest, page: number) {
  return {
    queryKey: photoGridKeys.dateAlbumDay(dateAlbumsListKey(day), day.album_date_id, page),
    queryFn: async ({ client }: { client: QueryClient }) => {
      // Beside the day's first page: the shapes of all its photos, so its pages arrive in place.
      ensureDayLayout(client, dateAlbumsListKey(day), day.album_date_id, dateAlbumRequestFilter(day)).catch(
        () => undefined
      );
      const result = await fetchDayPage(client, day, page);
      mergeDayPage(client, dateAlbumsListKey(day), day.album_date_id, page, result.items);
      return result;
    },
  };
}

/** A day page that failed and is not being asked again; with an observer, it is on screen. */
const failedOnScreen = (query: Query) =>
  query.state.status === "error" && query.state.fetchStatus === "idle" && query.getObserversCount() > 0;

/**
 * Loads the day pages of the list `listOptions` that are on screen, all at once, and returns the
 * `updateGroups` the photo list reports them through. Each page merges into the list as it arrives.
 * A page that failed is asked again each time the list reports placeholders on screen, so it does
 * not stay blank until it is scrolled away and back.
 */
export const useDateAlbumDayPages = (listOptions: AlbumDateListOptions, queryOptions?: { skip?: boolean }) => {
  const photoOrder = usePhotoOrder();
  const options = { ...listOptions, order: photoOrder.order };
  const { pages, updateGroups: reportPages } = useDayPagesOnScreen(JSON.stringify(dateAlbumsListKey(options)));
  const queryClient = useQueryClient();
  const enabled = !queryOptions?.skip && photoOrder.ready;
  useQueries({
    queries: pages.map(({ day, page }) => ({ ...dayPageQuery({ ...options, album_date_id: day }, page), enabled })),
  });
  return useCallback(
    (visibleGroups: PigVisibleGroup<PigPhoto>[]) => {
      reportPages(visibleGroups);
      void queryClient.refetchQueries({ queryKey: photoGridKeys.kind("dateAlbum"), predicate: failedOnScreen });
    },
    [reportPages, queryClient]
  );
};
