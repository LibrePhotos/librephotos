/**
 * How the My Albums list can be ordered (doc 08, the web's AlbumSortMenu #620).
 * Only orders the mirror can answer: the web's "date taken" needs each album's
 * first photo date, which the mirror does not keep per album, so it offers the
 * album's own created / updated times instead. Pure (no imports) so the
 * settings store can validate a persisted value without loading the database.
 */
export const USER_ALBUM_SORTS = ["name", "created_desc", "created_asc", "count_desc", "updated_desc"] as const;

export type UserAlbumSort = (typeof USER_ALBUM_SORTS)[number];

/** The list's order before the user picks one: newest album first. */
export const DEFAULT_USER_ALBUM_SORT: UserAlbumSort = "created_desc";

export function isUserAlbumSort(value: unknown): value is UserAlbumSort {
  return typeof value === "string" && USER_ALBUM_SORTS.some((sort) => sort === value);
}
