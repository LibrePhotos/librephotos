import moment from "moment";

export const copyToClipboard = (str) => {
  const el = document.createElement("textarea");
  el.value = str;
  document.body.appendChild(el);
  el.select();
  document.execCommand("copy");
  document.body.removeChild(el);
};

export function adjustDateFormatForSingleGroup(group) {
  group.date =
    moment(group.date).format("MMM Do YYYY, dddd") !== "Invalid date"
      ? moment(group.date).format("MMM Do YYYY, dddd")
      : group.date;
}

export function getPhotosFlatFromSingleGroup(group) {
  return group.items;
}

export function adjustDateFormat(photosGroupedByDate) {
  photosGroupedByDate.forEach(
    (group) =>
      (group.date =
        moment(group.date).format("MMM Do YYYY, dddd") !== "Invalid date"
          ? moment(group.date).format("MMM Do YYYY, dddd")
          : group.date)
  );
}

export function getPhotosFlatFromGroupedByDate(photosGroupedByDate) {
  return photosGroupedByDate.flatMap((el) => el.items);
}

export function addTempElementsToGroups(photosGroupedByDate) {
  photosGroupedByDate.forEach((group) => {
    for (var i = 0; i < group.numberOfItems; i++) {
      group.items.push({ id: i, aspectRatio: 1, isTemp: true });
    }
  });
}

export function addTempElementsToFlatList(photosCount) {
  var newPhotosFlat = [];
  for (var i = 0; i < photosCount; i++) {
    newPhotosFlat.push({ id: i, aspectRatio: 1, isTemp: true });
  }
  return newPhotosFlat;
}
