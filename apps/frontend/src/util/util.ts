/* eslint no-plusplus: ["error", { "allowForLoopAfterthoughts": true }] */
import { escapeRegExp } from "lodash-es";
import { DateTime } from "luxon";
import type { DirTree } from "../api_client/folders/types";
import { Media, type DatePhotosGroup, type IncompleteDatePhotosGroup, type PigPhoto } from "../api_client/photos/types";
import i18n, { i18nResolvedLanguage } from "../i18n";
import { parsePhotoTimestamp } from "./dateUtils";

export const EMAIL_REGEX = /^\w+([-.]?\w+){0,2}(\+?\w+([-.]?\w+){0,2})?@(\w+-?\w+\.){1,9}[a-z]{2,}$/;

export const copyToClipboard = (str: string) => {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(str);
  } else {
    const el = document.createElement("textarea");
    el.value = str;
    document.body.appendChild(el);
    el.select();
    document.execCommand("copy");
    document.body.removeChild(el);
  }
};

// The undated group's date from the search endpoint, and from the album, person,
// place, thing and tag lists on servers before 1.3 (those send null now).
export const LEGACY_UNDATED_GROUP_DATE = "No timestamp";

// TODO: Add ordinal suffix to day of month when implemented in luxon (NB, is it still valid?)
export function formatDateForPhotoGroups(photoGroups: DatePhotosGroup[]): DatePhotosGroup[] {
  return photoGroups.map(photoGroup => {
    if (photoGroup.date === null || photoGroup.date === LEGACY_UNDATED_GROUP_DATE) {
      return { ...photoGroup, date: i18n.t("sidemenu.withouttimestamp") };
    }
    // Group dates are the first photo's exif_timestamp: wall-clock time tagged
    // as UTC. Read in the viewer's zone, late or early shots land on another day.
    const date = parsePhotoTimestamp(photoGroup.date);
    if (date.isValid) {
      return {
        ...photoGroup,
        year: date.year,
        month: date.month,
        date: date.setLocale(i18nResolvedLanguage()).toLocaleString(DateTime.DATE_HUGE),
      };
    }
    return photoGroup;
  });
}

export function getPhotosFlatFromSingleGroup(group: DatePhotosGroup) {
  return group.items;
}

export function getPhotosFlatFromGroupedByDate(photosGroupedByDate: DatePhotosGroup[]) {
  return photosGroupedByDate.flatMap(getPhotosFlatFromSingleGroup);
}

/**
 * A grid placeholder for a photo whose page has not loaded yet: square, no
 * image, `isTemp` set. Every other field holds what the PigPhoto schema
 * defaults it to, so the placeholder is a PigPhoto like the photos around it.
 */
export function tempPigPhoto(id: string): PigPhoto {
  return {
    id,
    image_hash: "",
    aspectRatio: 1,
    type: Media.IMAGE,
    is_hdr: false,
    rating: 0,
    shared_to: [],
    isTemp: true,
    has_raw_variant: false,
  };
}

export function addTempElementsToGroups(photosGroupedByDate: IncompleteDatePhotosGroup[]) {
  photosGroupedByDate.forEach(group => {
    for (let i = 0; i < group.numberOfItems; i++) {
      group.items.push(tempPigPhoto(i.toString()));
    }
  });
}

export function addTempElementsToFlatList(photosCount: number) {
  const newPhotosFlat: PigPhoto[] = [];
  for (let i = 0; i < photosCount; i++) {
    newPhotosFlat.push(tempPigPhoto(`temp-${i}`));
  }
  return newPhotosFlat;
}

/** Query-string params from the entries of `params` that are set; values are stringified. */
export function definedSearchParams(params: Record<string, string | number | undefined>): URLSearchParams {
  const entries: [string, string][] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) entries.push([key, String(value)]);
  }
  return new URLSearchParams(entries);
}

export function fuzzyMatch(query: string, value: string): boolean {
  // Whitespace is dropped first: checking the raw query let "  " through to a
  // reduce() over no characters, which threw and crashed the search box.
  const chars = query.toLowerCase().replace(/\s/g, "").split("");
  if (chars.length === 0) {
    return true;
  }
  const expression = chars
    .map(a => escapeRegExp(a))
    .join(".*")
    .concat(".*");
  return new RegExp(expression).test(value.toLowerCase());
}

export function mergeDirTree(tree: DirTree[], branch: DirTree): DirTree[] {
  return tree.map(folder => {
    if (branch.absolute_path === folder.absolute_path) {
      return { ...folder, children: branch.children };
    }
    if (branch.absolute_path.startsWith(folder.absolute_path)) {
      const newTreeData = mergeDirTree(folder.children, branch);
      return { ...folder, children: newTreeData };
    }
    return folder;
  });
}

export type PartialPhotoWithLocation = {
  id: string;
  exif_gps_lat: number | null;
  exif_gps_lon: number | null;
};

export function getAveragedCoordinates<Located extends Pick<PartialPhotoWithLocation, "exif_gps_lat" | "exif_gps_lon">>(
  photos: readonly Located[]
) {
  const { lat, lon } = photos.reduce(
    (acc, photo) => {
      acc.lat += parseFloat(`${photo.exif_gps_lat}`);
      acc.lon += parseFloat(`${photo.exif_gps_lon}`);
      return acc;
    },
    { lat: 0, lon: 0 }
  );
  return { avgLat: lat / photos.length, avgLon: lon / photos.length };
}
