/* eslint no-plusplus: ["error", { "allowForLoopAfterthoughts": true }] */
import _ from "lodash";
import { DateTime } from "luxon";

import type { UserPhotosGroup } from "../actions/photosActions";
import type { DatePhotosGroup, IncompleteDatePhotosGroup, PigPhoto } from "../actions/photosActions.types";
import type { DirTree } from "../api_client/dir-tree";
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

// TODO: Add ordinal suffix to day of month when implemented in luxon (NB, is it still valid?)
export function formatDateForPhotoGroups(photoGroups: DatePhotosGroup[]): DatePhotosGroup[] {
  return photoGroups.map(photoGroup => {
    if (photoGroup.date === null) {
      return { ...photoGroup, date: i18n.t<string>("sidemenu.withouttimestamp") };
    }
    const date = DateTime.fromISO(photoGroup.date);
    if (date.isValid) {
      return {
        ...photoGroup,
        year: date.year,
        month: date.month,
        date: date.setLocale(i18nResolvedLanguage).toLocaleString(DateTime.DATE_HUGE),
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
