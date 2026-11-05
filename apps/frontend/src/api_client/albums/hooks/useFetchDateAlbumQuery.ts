import { endpoints, photoGridKeys } from "@librephotos/api-client";
import type {
  DateAlbumsListKey,
  DayPhotosPage,
  IncompleteDatePhotosGroup,
  MediaType,
  PhotoOrder,
  Photoset,
} from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { type TimelineFilter } from "../../../components/photolist/timelineFilter";
import { apiClient, ApiError, queryClient } from "../../api";
import { usePhotoOrder } from "../../user/hooks/usePhotoOrder";
import { dayLayoutQuery, ensureDayLayout } from "./dateAlbumLayout";
import { DATE_ALBUM_PAGE_SIZE, dateAlbumRequestFilter, dateAlbumsListKey } from "./useFetchDateAlbumsQuery";

type AlbumDateOption = {
  photosetType: Photoset;
  album_date_id: number;
  page: number;
  username?: string;
  person_id?: number;
  folder?: string;
  mediaType?: MediaType;
  timelineFilter?: TimelineFilter;
  library?: number;
  withLibraries?: boolean;
};

/** A day's request options: the list's filters, the day and the photo order (#2712). */
type DayRequest = Omit<AlbumDateOption, "page"> & { order: PhotoOrder };

/**
 * The `after` of page `page` of a day: null for the first, the previous page's `next` when that page
 * is loaded and current, else the day's layout. Undefined for a page past the end of the day.
 */
async function pageCursor(day: DayRequest, page: number): Promise<string | null | undefined> {
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
async function fetchDayPage(day: DayRequest, page: number): Promise<DayPhotosPage> {
  const read = async () => {
    const after = await pageCursor(day, page);
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
function mergeDayPage(listKey: DateAlbumsListKey, dayId: number, page: number, items: DayPhotosPage["items"]) {
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

// One page of a day, in the same photo order (#2712) as the day list it fills in.
export const useFetchDateAlbumQuery = (dayOptions: AlbumDateOption, queryOptions?: { skip?: boolean }) => {
  const photoOrder = usePhotoOrder();
  const options = { ...dayOptions, order: photoOrder.order };
  return useQuery({
    queryKey: photoGridKeys.dateAlbumDay(dateAlbumsListKey(options), options.album_date_id, options.page),
    queryFn: async () => {
      // Beside the day's first page: the shapes of all its photos, so its pages arrive in place.
      ensureDayLayout(
        queryClient,
        dateAlbumsListKey(options),
        options.album_date_id,
        dateAlbumRequestFilter(options)
      ).catch(() => undefined);
      const result = await fetchDayPage(options, options.page);
      mergeDayPage(dateAlbumsListKey(options), options.album_date_id, options.page, result.items);
      return result;
    },
    enabled: !queryOptions?.skip && photoOrder.ready,
  });
};
