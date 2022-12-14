/* eslint no-plusplus: ["error", { "allowForLoopAfterthoughts": true }] */
import _ from "lodash";
import { DateTime } from "luxon";

import type { UserPhotosGroup } from "../actions/photosActions";
import type { DatePhotosGroup, IncompleteDatePhotosGroup, PigPhoto } from "../actions/photosActions.types";
import i18n from "../i18n";

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

// TODO: Add ordinal suffix to day of month when implemented in luxon
// TODO(sickelap): rafactor adjustDateFormatForSingleGroup to not mutate param
/* eslint no-param-reassign: ["error", { "props": false }] */
export function adjustDateFormatForSingleGroup(group: DatePhotosGroup) {
  if (group.date != null) {
    const date = DateTime.fromISO(group.date);
    if (date.isValid) {
      group.year = date.year;
      group.month = date.month;
      group.date = date.setLocale(i18n.resolvedLanguage.replace("_", "-")).toLocaleString(DateTime.DATE_HUGE);
    }
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

export function fuzzyMatch(query: string, value: string): boolean {
  if (query.split("").length > 0) {
    const expression = query
      .toLowerCase()
      .replace(/\s/g, "")
      .split("")
      .map(a => _.escapeRegExp(a))
      .reduce((a, b) => `${a}.*${b}`);
    return new RegExp(expression).test(value.toLowerCase());
  }
  return true;
}
