import type { AlbumCollection, UserAlbumInfo } from "@librephotos/api-client";
import { useFetchAlbumCollectionsQuery } from "../../api_client/albums/hooks";
import {
  albumsInCollection,
  collectionCounts,
  effectiveCollectionFilter,
  type CollectionFilter,
} from "./collectionFilter";

type AlbumCollectionFilterState = {
  collections: AlbumCollection[];
  /** The filter in effect (a deleted collection's id shows every album). */
  filter: CollectionFilter;
  /** The chosen collection, when the filter is one. */
  collection: AlbumCollection | undefined;
  /** The albums the grid shows. */
  shown: UserAlbumInfo[];
  counts: { byCollection: ReadonlyMap<number, number>; none: number; all: number };
};

/** My Albums filtered by the collection in its URL (#1009), with the counts its chips show. */
export function useAlbumCollectionFilter(
  albums: readonly UserAlbumInfo[] | undefined,
  selected: CollectionFilter
): AlbumCollectionFilterState {
  const { data } = useFetchAlbumCollectionsQuery();
  const collections = data ?? [];
  // Until the collections load, a chosen id cannot be checked yet: keep it rather than flash every album.
  const filter = data ? effectiveCollectionFilter(selected, data) : selected;
  const all = albums ?? [];
  const { byCollection, none } = collectionCounts(all);
  return {
    collections,
    filter,
    collection: collections.find(collection => collection.id === filter),
    shown: albumsInCollection(all, filter),
    counts: { byCollection, none, all: all.length },
  };
}
