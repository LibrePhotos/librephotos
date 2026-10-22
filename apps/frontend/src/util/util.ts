/* eslint no-plusplus: ["error", { "allowForLoopAfterthoughts": true }] -- no ++ outside for-loop updates */
import type { DirTree } from "@librephotos/api-client";
import { Media, type DatePhotosGroup, type IncompleteDatePhotosGroup, type PigPhoto } from "@librephotos/api-client";
import { escapeRegExp } from "lodash-es";
import { DateTime } from "luxon";
import i18n from "../i18n";
import { parsePhotoTimestamp } from "./dateUtils";

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

/** A note for a dated group's heading, from its day (a person's age on the person page, #2751). */
export type GroupNote = (day: DateTime) => string | null;

// TODO: Add ordinal suffix to day of month when implemented in luxon (NB, is it still valid?)
export function formatDateForPhotoGroups(
  photoGroups: DatePhotosGroup[],
  note?: GroupNote
): (DatePhotosGroup & { note?: string | null })[] {
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
        date: date.toLocaleString(DateTime.DATE_HUGE),
        note: note?.(date),
      };
    }
    return photoGroup;
  });
}

function getPhotosFlatFromSingleGroup(group: DatePhotosGroup) {
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

// The combining diacritical mark blocks, as code point ranges. Only these are
// dropped: the marks of Indic scripts, Japanese dakuten and the like change the
// letter. A regex class of combining marks would trip no-misleading-character-class.
const DIACRITIC_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0300, 0x036f],
  [0x1ab0, 0x1aff],
  [0x1dc0, 0x1dff],
  [0x20d0, 0x20ff],
  [0xfe20, 0xfe2f],
];

function isDiacritic(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return DIACRITIC_RANGES.some(([first, last]) => code >= first && code <= last);
}

// Latin letters with no separate mark to split off, as in the backend's fold().
const UNSPLIT_LETTERS: Record<string, string> = {
  ß: "ss",
  ø: "o",
  ł: "l",
  đ: "d",
  ħ: "h",
  ı: "i",
  ŧ: "t",
  æ: "ae",
  œ: "oe",
};

// Lower case without diacritics, so "Zurich" and "Zürich" compare equal. The
// backend folds search text the same way (api/models/photo_search.py fold).
function foldText(text: string): string {
  return Array.from(text.toLowerCase().normalize("NFKD"))
    .filter(char => !isDiacritic(char))
    .map(char => UNSPLIT_LETTERS[char] ?? char)
    .join("")
    .normalize("NFC");
}

export function fuzzyMatch(query: string, value: string): boolean {
  // Whitespace is dropped first: checking the raw query let "  " through to a
  // reduce() over no characters, which threw and crashed the search box.
  // Both sides are folded, so "cafe" suggests "Café" and "café" suggests "Cafe".
  const chars = foldText(query).replace(/\s/g, "").split("");
  if (chars.length === 0) {
    return true;
  }
  const expression = chars
    .map(a => escapeRegExp(a))
    .join(".*")
    .concat(".*");
  return new RegExp(expression).test(foldText(value));
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
