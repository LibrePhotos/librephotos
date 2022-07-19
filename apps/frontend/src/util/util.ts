import { DateTime } from "luxon";

import type { UserPhotosGroup } from "../actions/photosActions";
import type { DatePhotosGroup, IncompleteDatePhotosGroup, PigPhoto } from "../actions/photosActions.types";
import i18n from "../i18n";

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

// To-Do: Add ordinal suffix to day of month when implemented in luxon
export function adjustDateFormatForSingleGroup(group: DatePhotosGroup) {
  if (group.date != null) {
    group.date =
      DateTime.fromISO(group.date).toLocaleString(DateTime.DATETIME_MED) !== "Invalid DateTime"
        ? DateTime.fromISO(group.date).setLocale(i18n.resolvedLanguage.replace("_", "-")).toFormat("MMMM d yyyy, cccc")
        : group.date;
  } else {
    group.date = i18n.t<string>("sidemenu.withouttimestamp");
  }
}

export function adjustDateFormat(photosGroupedByDate: DatePhotosGroup[]) {
  photosGroupedByDate.forEach(adjustDateFormatForSingleGroup);
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
      id: i.toString(),
      aspectRatio: 1,
      isTemp: true,
    } as PigPhoto);
  }
  return newPhotosFlat;
}

export function getPhotosFlatFromGroupedByUser(photosGroupedByUser: UserPhotosGroup[]) {
  return photosGroupedByUser.flatMap(el => el.photos);
}
