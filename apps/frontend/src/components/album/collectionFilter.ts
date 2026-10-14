import type { AlbumCollection, UserAlbumInfo } from "@librephotos/api-client";

/** The My Albums chip for the albums in no collection. */
export const NOT_IN_A_COLLECTION = "none";

/** What My Albums shows (#1009): every album, the albums of one collection, or those in none. */
export type CollectionFilter = number | typeof NOT_IN_A_COLLECTION | undefined;

type CollectionSearch = { collection?: number | typeof NOT_IN_A_COLLECTION };

/** The My Albums route's `validateSearch`: a collection id or "none"; anything else is every album. */
export function validateCollectionSearch(search: Record<string, unknown>): CollectionSearch {
  const { collection } = search;
  if (collection === NOT_IN_A_COLLECTION) return { collection };
  const id = typeof collection === "string" ? Number(collection) : collection;
  return typeof id === "number" && Number.isInteger(id) && id > 0 ? { collection: id } : {};
}

/** The filter in effect: a collection that no longer exists (deleted elsewhere) shows every album. */
export function effectiveCollectionFilter(
  filter: CollectionFilter,
  collections: readonly AlbumCollection[]
): CollectionFilter {
  if (typeof filter !== "number") return filter;
  return collections.some(collection => collection.id === filter) ? filter : undefined;
}

/** The albums `filter` keeps. */
export function albumsInCollection(albums: readonly UserAlbumInfo[], filter: CollectionFilter): UserAlbumInfo[] {
  if (filter === undefined) return [...albums];
  if (filter === NOT_IN_A_COLLECTION) return albums.filter(album => album.collection_ids.length === 0);
  return albums.filter(album => album.collection_ids.includes(filter));
}

/** How many of `albums` each collection holds, and how many are in none. */
export function collectionCounts(albums: readonly UserAlbumInfo[]): {
  byCollection: ReadonlyMap<number, number>;
  none: number;
} {
  const byCollection = new Map<number, number>();
  let none = 0;
  for (const album of albums) {
    if (album.collection_ids.length === 0) none += 1;
    for (const id of album.collection_ids) byCollection.set(id, (byCollection.get(id) ?? 0) + 1);
  }
  return { byCollection, none };
}
