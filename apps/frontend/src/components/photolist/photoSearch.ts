import type { ParsedLocation } from "@tanstack/react-router";

/**
 * The photo a photo list shows in its lightbox, as the list's `?photo=<id>` search param (#2231):
 * Back closes the lightbox, a reload reopens it, and the address is a link to that photo in that list.
 */
export type PhotoSearch = { photo?: string };

declare module "@tanstack/react-router" {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- module augmentation merges into the router's interface
  interface HistoryState {
    /** On the history entry the lightbox pushed: the scroll-restoration key of the grid entry below it. */
    lightboxFrom?: string;
  }
}

/**
 * Ids are hex strings; the router hands back what the URL holds. Anything that is not a plain,
 * non-empty string is dropped (the grid shows without a lightbox).
 */
export function validatePhotoSearch(search: Record<string, unknown>): PhotoSearch {
  const { photo } = search;
  return typeof photo === "string" && photo.length > 0 ? { photo } : {};
}

/** A route's own `validateSearch` with the open photo added: every photo list route uses one. */
export function withPhotoSearch<T extends object>(
  validate: (search: Record<string, unknown>) => T
): (search: Record<string, unknown>) => T & PhotoSearch {
  return search => ({ ...validate(search), ...validatePhotoSearch(search) });
}

/**
 * Router `getScrollRestorationKey`. The history entry the lightbox pushes carries the key of the
 * grid entry it was opened from (`lightboxFrom`), so both share one saved scroll position: Back
 * from the lightbox keeps the grid where the lightbox left it (scrolled to the photo last viewed)
 * instead of jumping to where the viewer clicked. Every other entry keeps the router's own key.
 */
export function photoListScrollRestorationKey(location: Pick<ParsedLocation, "state" | "href">): string {
  return location.state.lightboxFrom ?? location.state.__TSR_key ?? location.href;
}
