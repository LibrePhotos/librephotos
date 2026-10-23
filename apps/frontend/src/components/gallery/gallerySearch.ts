import type { GalleryFilter } from "@librephotos/api-client";
import { validatePhotoSearch, type PhotoSearch } from "../photolist/photoSearch";

/** The public gallery's tabs (#434); the timeline is the default and stays out of the address. */
export const GALLERY_TABS = ["timeline", "places", "people", "photographers"] as const;
export type GalleryTab = (typeof GALLERY_TABS)[number];

/**
 * The gallery's address: the tab, the filters (one photographer, a town, a person) and the photo
 * open in the lightbox. A link to any of them shows the same slice to anyone.
 */
export type GallerySearch = PhotoSearch & {
  tab?: Exclude<GalleryTab, "timeline">;
  owner?: number;
  place?: string;
  person?: number;
};

function positiveInteger(value: unknown): number | undefined {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isInteger(number) && number > 0 ? number : undefined;
}

function galleryTab(value: unknown): GallerySearch["tab"] {
  return value === "places" || value === "people" || value === "photographers" ? value : undefined;
}

/** What the router hands the gallery: anything it does not know is dropped. */
export function validateGallerySearch(search: Record<string, unknown>): GallerySearch {
  const tab = galleryTab(search.tab);
  const place = typeof search.place === "string" && search.place.trim() ? search.place : undefined;
  return {
    ...validatePhotoSearch(search),
    ...(tab === undefined ? {} : { tab }),
    ...galleryFilter({ owner: positiveInteger(search.owner), place, person: positiveInteger(search.person) }),
  };
}

/** The filters of the address, without the ones that are not set (the query key holds it). */
export function galleryFilter({ owner, place, person }: GallerySearch): GalleryFilter {
  return {
    ...(owner === undefined ? {} : { owner }),
    ...(place === undefined ? {} : { place }),
    ...(person === undefined ? {} : { person }),
  };
}
