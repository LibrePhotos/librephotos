import { DateTime } from "luxon";

import type { UserPhotosGroup } from "../actions/photosActions";
import type { DatePhotosGroup, IncompleteDatePhotosGroup, PigPhoto } from "../actions/photosActions.types";
import i18n from "../i18n";

export const EMAIL_REGEX = // eslint-disable-next-line no-control-regex
  /(?:[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\[(?:(?:(2(5[0-5]|[0-4][0-9])|1[0-9][0-9]|[1-9]?[0-9]))\.){3}(?:(2(5[0-5]|[0-4][0-9])|1[0-9][0-9]|[1-9]?[0-9])|[a-z0-9-]*[a-z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)\])/;

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
