/* eslint no-plusplus: ["error", { "allowForLoopAfterthoughts": true }] */
import _ from "lodash";
import { DateTime } from "luxon";
import type { DirTree } from "../api_client/dir-tree";
import type { DatePhotosGroup, IncompleteDatePhotosGroup, PigPhoto } from "../api_client/photos/types";
import i18n, { i18nResolvedLanguage } from "../i18n";

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

// Browsers only accept image/png (and a few others) as a clipboard image MIME type, so
// WebP/JPEG source blobs are redrawn onto a canvas and re-encoded before being written.
export async function copyImageToClipboard(imageUrl: string): Promise<void> {
  const response = await fetch(imageUrl, { credentials: "include" });
  const sourceBlob = await response.blob();

  const pngBlob = await new Promise<Blob>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(sourceBlob);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Could not get canvas context"));
        return;
      }
      ctx.drawImage(image, 0, 0);
      canvas.toBlob(blob => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Could not convert image to PNG"));
        }
      }, "image/png");
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not load image"));
    };
    image.src = objectUrl;
  });

  await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
}

// TODO: Add ordinal suffix to day of month when implemented in luxon (NB, is it still valid?)
export function formatDateForPhotoGroups(photoGroups: DatePhotosGroup[]): DatePhotosGroup[] {
  return photoGroups.map(photoGroup => {
    if (photoGroup.date === null) {
      return { ...photoGroup, date: i18n.t("sidemenu.withouttimestamp") };
    }
    const date = DateTime.fromISO(photoGroup.date);
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

export function addTempElementsToGroups(photosGroupedByDate: IncompleteDatePhotosGroup[]) {
  photosGroupedByDate.forEach(group => {
    for (let i = 0; i < group.numberOfItems; i++) {
      group.items.push({
        id: i.toString(),
        aspectRatio: 1,
        isTemp: true,
      } as PigPhoto);
    }
  });
}

export function addTempElementsToFlatList(photosCount: number) {
  const newPhotosFlat: PigPhoto[] = [];
  for (let i = 0; i < photosCount; i++) {
    newPhotosFlat.push({
      id: `temp-${i}`,
      aspectRatio: 1,
      isTemp: true,
    } as PigPhoto);
  }
  return newPhotosFlat;
}

export function getPhotosFlatFromGroupedByUser(photosGroupedByUser: any[]) {
  return photosGroupedByUser.flatMap(el => el.photos);
}

export function fuzzyMatch(query: string, value: string): boolean {
  if (query.split("").length > 0) {
    const expression = query
      .toLowerCase()
      .replace(/\s/g, "")
      .split("")
      .map(a => _.escapeRegExp(a))
      .reduce((a, b) => `${a}.*${b}`)
      .concat(".*");
    return new RegExp(expression).test(value.toLowerCase());
  }
  return true;
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
  exif_gps_lat: number | null;
  exif_gps_lon: number | null;
  [key: string]: any;
};

export function getAveragedCoordinates(photos: PartialPhotoWithLocation[]) {
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
