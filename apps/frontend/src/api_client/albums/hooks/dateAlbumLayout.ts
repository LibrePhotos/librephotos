import { endpoints, photoGridKeys } from "@librephotos/api-client";
import type {
  DateAlbumFilter,
  DateAlbumLayout,
  DateAlbumsListKey,
  IncompleteDatePhotosGroup,
} from "@librephotos/api-client";
import type { QueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api";

/** How many photos one page of a day holds; a day of more pages gets its layout. */
const DAY_PAGE_SIZE = endpoints.DATE_ALBUM_PAGE_SIZE;

type Placeholder = { isTemp?: boolean; aspectRatio: number };
type LayoutGroup<T> = Pick<IncompleteDatePhotosGroup, "id" | "numberOfItems"> & { items: T[] };

/** Whether a day is worth its layout request: one that loads in more than one page. */
export const needsDayLayout = (numberOfItems: number) => numberOfItems > DAY_PAGE_SIZE;

/**
 * `items` with the placeholders (photos not loaded yet) shaped as the day's layout says, so the grid
 * places them where their photos will go. Loaded photos keep their own shape. Null when nothing
 * changes. A layout from before photos were added or removed shapes the photos it covers.
 */
export function applyDayLayout<T extends Placeholder>(items: readonly T[], aspectRatios: readonly (number | null)[]) {
  let shaped: T[] | null = null;
  const end = Math.min(items.length, aspectRatios.length);
  for (let i = 0; i < end; i++) {
    const item = items[i];
    const ratio = aspectRatios[i];
    if (item === undefined || !item.isTemp || ratio === null || ratio === undefined || ratio <= 0) continue;
    if (item.aspectRatio === ratio) continue;
    shaped ??= items.slice();
    shaped[i] = { ...item, aspectRatio: ratio };
  }
  return shaped;
}

// The layouts of `listKey`'s days already in the query cache and still valid.
function cachedDayLayouts(queryClient: QueryClient, listKey: DateAlbumsListKey): DateAlbumLayout[] {
  return queryClient
    .getQueryCache()
    .findAll({ queryKey: photoGridKeys.dateAlbumLayouts(listKey[0]) })
    .flatMap(query => {
      const layout = queryClient.getQueryData<DateAlbumLayout>(query.queryKey);
      const expected = photoGridKeys.dateAlbumLayout(listKey, layout?.id ?? -1);
      const sameList =
        query.queryKey.length === expected.length && expected.every((part, i) => query.queryKey[i] === part);
      return layout && !query.state.isInvalidated && sameList ? [layout] : [];
    });
}

/**
 * Shapes the placeholders of `groups` (a list just fetched, all placeholders but for cached pages)
 * with the layouts its days already have, so a refetch keeps a big day still.
 */
export function hydrateGroupsFromCachedLayouts<T extends Placeholder>(
  queryClient: QueryClient,
  groups: LayoutGroup<T>[],
  listKey: DateAlbumsListKey
) {
  cachedDayLayouts(queryClient, listKey).forEach(layout => {
    const group = groups.find(g => g.id === layout.id);
    const shaped = group && applyDayLayout(group.items, layout.aspectRatios);
    if (group && shaped) group.items = shaped;
  });
}

/**
 * Loads the layout of a day of the list `listKey` once, if the day has more than one page, and
 * shapes the day's placeholders in the list with it. The day pages call it as they load, so the
 * layout comes in beside the day's first page; a day of one page needs none.
 */
export async function ensureDayLayout(
  queryClient: QueryClient,
  listKey: DateAlbumsListKey,
  albumDateId: number,
  filter: DateAlbumFilter
) {
  const listQueryKey = photoGridKeys.dateAlbumList(listKey);
  const day = queryClient.getQueryData<IncompleteDatePhotosGroup[]>(listQueryKey)?.find(g => g.id === albumDateId);
  if (!day || !needsDayLayout(day.numberOfItems)) return;
  const layoutKey = photoGridKeys.dateAlbumLayout(listKey, albumDateId);
  const state = queryClient.getQueryState(layoutKey);
  // Asked already: loaded, loading, or failed (a server without layouts) until the list refreshes.
  if (state && (state.fetchStatus === "fetching" || (state.status !== "pending" && !state.isInvalidated))) return;

  // eslint-disable-next-line @tanstack/query/exhaustive-deps -- the list key in layoutKey holds the filters
  const layout = await queryClient.fetchQuery({
    queryKey: layoutKey,
    queryFn: () => endpoints.fetchDateAlbumLayout(apiClient, albumDateId, filter),
    // A day of 200k photos: comparing the arrays to share structure cost a frame for nothing.
    structuralSharing: false,
  });
  queryClient.setQueryData<IncompleteDatePhotosGroup[]>(listQueryKey, groups => {
    if (!groups) return groups;
    const index = groups.findIndex(g => g.id === albumDateId);
    const group = groups[index];
    const shaped = group && applyDayLayout(group.items, layout.aspectRatios);
    if (!group || !shaped) return groups;
    const next = [...groups];
    next[index] = { ...group, items: shaped };
    return next;
  });
}
