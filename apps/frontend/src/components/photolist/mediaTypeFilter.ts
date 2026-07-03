export type MediaType = "all" | "photos" | "videos";

export const DEFAULT_MEDIA_TYPE: MediaType = "all";

// The three states map to the backend's ?photo=true / ?video=true album filter.
// "all" sends neither param.
export function mediaTypeToParams(mediaType: MediaType | undefined): { photo?: "true"; video?: "true" } {
  if (mediaType === "photos") {
    return { photo: "true" };
  }
  if (mediaType === "videos") {
    return { video: "true" };
  }
  return {};
}

// Boolean form of the same filter, for the BulkPhotoQuery `photosetQuery`
// (server-side select-all), which uses booleans rather than URL "true" strings.
export function mediaTypeToBulkQuery(mediaType: MediaType | undefined): { photo?: boolean; video?: boolean } {
  if (mediaType === "photos") {
    return { photo: true };
  }
  if (mediaType === "videos") {
    return { video: true };
  }
  return {};
}

// Route `validateSearch` for surfaces that expose the media-type filter. Only
// the non-default values are kept in the URL; "all" is represented by the
// absence of the param.
export function validateMediaSearch(search: Record<string, unknown>): { media?: MediaType } {
  const { media } = search;
  return media === "photos" || media === "videos" ? { media } : {};
}
