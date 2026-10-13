import type { AlbumMediaFilter, MediaType } from "@librephotos/api-client";

export const DEFAULT_MEDIA_TYPE: MediaType = "all";

// Every value of the per-view media filter, in menu order.
export const MEDIA_TYPES: readonly MediaType[] = ["all", "photos", "videos", "screenshots", "documents"];

// The backend's flag for each value (?photo=true, ?video=true, ?is_screenshot=true,
// ?is_document=true); "all" sends none.
const MEDIA_FLAGS: Record<MediaType, keyof AlbumMediaFilter | undefined> = {
  all: undefined,
  photos: "photo",
  videos: "video",
  screenshots: "is_screenshot",
  documents: "is_document",
};

// The URL-param form of the filter, as the album endpoints read it.
export function mediaTypeToParams(mediaType: MediaType | undefined): Partial<Record<keyof AlbumMediaFilter, "true">> {
  const params: Partial<Record<keyof AlbumMediaFilter, "true">> = {};
  const flag = mediaType && MEDIA_FLAGS[mediaType];
  if (flag) params[flag] = "true";
  return params;
}

// Boolean form of the same filter, for the BulkPhotoQuery `photosetQuery`
// (server-side select-all) and the api-client endpoints.
export function mediaTypeToBulkQuery(mediaType: MediaType | undefined): AlbumMediaFilter {
  const query: AlbumMediaFilter = {};
  const flag = mediaType && MEDIA_FLAGS[mediaType];
  if (flag) query[flag] = true;
  return query;
}

function isMediaType(value: unknown): value is MediaType {
  return MEDIA_TYPES.some(mediaType => mediaType === value);
}

// Route `validateSearch` for surfaces that expose the media-type filter. Only
// the non-default values are kept in the URL; "all" is represented by the
// absence of the param.
export function validateMediaSearch(search: Record<string, unknown>): { media?: MediaType } {
  const { media } = search;
  return isMediaType(media) && media !== DEFAULT_MEDIA_TYPE ? { media } : {};
}
