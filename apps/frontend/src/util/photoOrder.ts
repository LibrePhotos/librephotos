import type { DatePhotosGroup, PhotoOrder } from "@librephotos/api-client";
import { LEGACY_UNDATED_GROUP_DATE } from "./util";

// The date groups of an album, a place, a thing, a tag or a search come whole and newest first,
// so the web app puts them in the user's photo order itself (#2712). The day list of the
// timeline and the other date-album views is paged by the server, which sorts it (`order`).

const isUndated = (group: DatePhotosGroup) => group.date === null || group.date === LEGACY_UNDATED_GROUP_DATE;

/**
 * `groups`, which the server sends newest first, in `order`: oldest first reverses the days and
 * the photos in each. The group without a date stays last, its photos as they came, as on the
 * timeline. Newest first returns `groups` itself.
 */
export function orderDateGroups<G extends DatePhotosGroup>(groups: G[], order: PhotoOrder): G[] {
  if (order === "newest") return groups;
  const dated = groups.filter(group => !isUndated(group)).map(group => ({ ...group, items: group.items.toReversed() }));
  return [...dated.toReversed(), ...groups.filter(isUndated)];
}

/** `album` with its `grouped_photos` in `order`; `album` itself for newest first. */
export function withOrderedGroups<T extends { grouped_photos: DatePhotosGroup[] }>(album: T, order: PhotoOrder): T {
  if (order === "newest") return album;
  return { ...album, grouped_photos: orderDateGroups(album.grouped_photos, order) };
}
