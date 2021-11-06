import moment from "moment";
import { UserPhotosGroup } from "../actions/photosActions";
import { DatePhotosGroup, IncompleteDatePhotosGroup, PigPhoto } from "../actions/photosActions.types";

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

export function adjustDateFormatForSingleGroup(group: DatePhotosGroup) {
  group.date =
    moment(group.date).format("MMM Do YYYY, dddd") !== "Invalid date"
      ? moment(group.date).format("MMM Do YYYY, dddd")
      : group.date;
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
  photosGroupedByDate.forEach((group) => {
    for (var i = 0; i < group.numberOfItems; i++) {
      group.items.push({
        id: i.toString(),
        aspectRatio: 1,
        isTemp: true,
      } as PigPhoto);
    }
  });
}

export function addTempElementsToFlatList(photosCount: number) {
  var newPhotosFlat: PigPhoto[] = [];
  for (var i = 0; i < photosCount; i++) {
    newPhotosFlat.push({
      id: i.toString(),
      aspectRatio: 1,
      isTemp: true
    } as PigPhoto);
  }
  return newPhotosFlat;
}

export function getPhotosFlatFromGroupedByUser(photosGroupedByUser: UserPhotosGroup[]) {
  return photosGroupedByUser.flatMap((el) => el.photos);
}
