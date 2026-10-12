import type { BulkPhotoQuery, SelectAllPhotos } from "@librephotos/api-client";

/**
 * Which photos a bulk photo mutation applies to, as the selection hands it over: the hashes, or a
 * server-side "select all" (the query of the photo set and the photos left out of it).
 */
export type PhotoSelection =
  | { select_all?: false; image_hashes: string[] }
  | { select_all: true; query: BulkPhotoQuery; excluded_hashes?: string[] };

/** The hashes and the select-all set to pass to a bulk photo endpoint. */
export function selectionArgs(selection: PhotoSelection): [imageHashes: string[], selectAll?: SelectAllPhotos] {
  if (selection.select_all) {
    return [[], { query: selection.query, excludedHashes: selection.excluded_hashes }];
  }
  return [selection.image_hashes];
}

/** The one photo a selection of exactly one hash names, so its cached details can be refreshed. */
export function singlePhotoHash(selection: PhotoSelection): string | undefined {
  const [imageHash, ...others] = selection.select_all ? [] : selection.image_hashes;
  return others.length === 0 ? imageHash : undefined;
}
