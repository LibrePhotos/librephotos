import { photoGridKeys, Photoset, type PigPhoto } from "@librephotos/api-client";
import type { Query, QueryClient } from "@tanstack/react-query";
import { tempPigPhoto } from "../../util/util";
import { DATE_ALBUM_PAGE_SIZE } from "../albums/hooks/useFetchDateAlbumsQuery";
import { invalidatePhotoLists } from "./invalidatePhotoLists";
import type { PhotoSelection } from "./photoSelection";

type DayGroup = { id: number; numberOfItems: number; items: PigPhoto[] };

function isDayGroup(value: unknown): value is DayGroup {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "number" &&
    "numberOfItems" in value &&
    typeof value.numberOfItems === "number" &&
    "items" in value &&
    Array.isArray(value.items)
  );
}

function isDayGroupList(value: unknown): value is DayGroup[] {
  return Array.isArray(value) && value.every(isDayGroup);
}

/**
 * The day group without the photos in `hashes`, and the first page of the day that changed; null
 * when it held none of them. The placeholders behind them move up, and are renumbered: a
 * placeholder's id is its place in the day, which says which page to load for it.
 */
export function dayWithout(
  group: DayGroup,
  hashes: ReadonlySet<string>
): { group: DayGroup; firstPage: number } | null {
  let first = -1;
  const items: PigPhoto[] = [];
  group.items.forEach((item, i) => {
    if (!item.isTemp && hashes.has(item.image_hash)) {
      if (first === -1) first = i;
    } else {
      items.push(item);
    }
  });
  if (first === -1) return null;
  for (let i = first; i < items.length; i++) {
    if (items[i]?.isTemp) items[i] = tempPigPhoto(String(i));
  }
  const gone = group.items.length - items.length;
  return {
    group: { ...group, items, numberOfItems: Math.max(0, group.numberOfItems - gone) },
    firstPage: Math.floor(first / DATE_ALBUM_PAGE_SIZE) + 1,
  };
}

const dateListKind = photoGridKeys.kind("dateAlbums");
const dateDayKind = photoGridKeys.kind("dateAlbum");

// Day lists: ["photoGrid", "dateAlbums", photoset, ...]; day pages: ["photoGrid", "dateAlbum", photoset, day, page, ...].
const isUnder = (query: Query, kind: readonly unknown[]) => kind.every((part, i) => query.queryKey[i] === part);
const photosetOf = (query: Query) => query.queryKey[2];

/**
 * After photos were moved to the trash (or restored from it), take them out of every cached day
 * list they just left, in place, instead of reloading those lists.
 *
 * Reloading put every day back to placeholders, refilled one visible day at a time (seconds on a
 * big library). A lightbox open over the list then had no neighbours to step to: it closed on the
 * next delete, or stepped back or onto a placeholder. The day pages from the first changed one on
 * are dropped, as they hold the photo or now start one photo late; the grid loads them again when
 * it reaches them. The lists the photos join (the trash, or the timeline on a restore) and every
 * other kind of grid are refreshed as before. A server-side "select all" names no photos, so it
 * refreshes everything.
 */
export function applyTrashToggleToGrids(queryClient: QueryClient, selection: PhotoSelection, deleted: boolean) {
  if (selection.select_all) {
    invalidatePhotoLists(queryClient);
    return;
  }
  const hashes = new Set(selection.image_hashes);
  const leaves = (photoset: unknown) => (photoset === Photoset.IN_TRASHCAN) !== deleted;
  const changedFrom = new Map<string, number>();
  const dayKey = (photoset: unknown, day: unknown) => `${String(photoset)}|${String(day)}`;

  queryClient
    .getQueryCache()
    .findAll({ queryKey: dateListKind })
    .forEach(query => {
      const data = query.state.data;
      if (!leaves(photosetOf(query)) || !isDayGroupList(data)) return;
      let changed = false;
      const next: DayGroup[] = [];
      data.forEach(group => {
        const result = dayWithout(group, hashes);
        if (result === null) {
          next.push(group);
          return;
        }
        changed = true;
        const key = dayKey(photosetOf(query), group.id);
        changedFrom.set(key, Math.min(changedFrom.get(key) ?? Infinity, result.firstPage));
        if (result.group.numberOfItems > 0) next.push(result.group);
      });
      if (changed) queryClient.setQueryData(query.queryKey, next);
    });

  queryClient.removeQueries({
    queryKey: dateDayKind,
    predicate: query => {
      const [, , photoset, day, page] = query.queryKey;
      if (!leaves(photoset) || typeof page !== "number") return false;
      const from = changedFrom.get(dayKey(photoset, day));
      if (from !== undefined && page >= from) return true;
      // A loaded page whose list is gone from the cache.
      const data = query.state.data;
      return isDayGroup(data) && data.items.some(item => hashes.has(item.image_hash));
    },
  });

  void queryClient.invalidateQueries({
    queryKey: photoGridKeys.all,
    predicate: query => !((isUnder(query, dateListKind) || isUnder(query, dateDayKind)) && leaves(photosetOf(query))),
  });
}
