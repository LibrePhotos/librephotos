import { useSearch } from "@tanstack/react-router";
import { DEFAULT_MEDIA_TYPE, type MediaType } from "./mediaTypeFilter";

// Reads the per-view media-type filter from the current route's `?media` search
// param. Reset-per-view by design: the value lives in the URL, so it survives
// reload / back-forward for a given view but does not leak across surfaces.
export function useMediaTypeFilter(): MediaType {
  const search = useSearch({ strict: false }) as { media?: MediaType };
  return search.media ?? DEFAULT_MEDIA_TYPE;
}
