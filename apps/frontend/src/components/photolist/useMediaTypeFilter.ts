import type { MediaType } from "@librephotos/api-client";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback } from "react";
import { DEFAULT_MEDIA_TYPE } from "./mediaTypeFilter";

// Reads the per-view media-type filter from the current route's `?media` search
// param. Reset-per-view by design: the value lives in the URL, so it survives
// reload / back-forward for a given view but does not leak across surfaces.
export function useMediaTypeFilter(): MediaType {
  // Only the param it reads: the lightbox's `?photo=` does not re-render the page.
  return useSearch({ strict: false, select: search => search.media }) ?? DEFAULT_MEDIA_TYPE;
}

// Sets the current page's `?media` param; the default clears it so the URL stays clean.
export function useSetMediaTypeFilter(): (value: MediaType) => void {
  const navigate = useNavigate();
  return useCallback(
    (value: MediaType) => {
      void navigate({
        // The current page: navigate resolves a missing `to` to "." as well.
        to: ".",
        search: prev => ({ ...prev, media: value === DEFAULT_MEDIA_TYPE ? undefined : value }),
      });
    },
    [navigate]
  );
}
