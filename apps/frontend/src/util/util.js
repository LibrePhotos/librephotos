import moment from "moment";

export const copyToClipboard = (str) => {
  const el = document.createElement("textarea");
  el.value = str;
  document.body.appendChild(el);
  el.select();
  document.execCommand("copy");
  document.body.removeChild(el);
};

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

export function getPhotosFlatFromGroupedByUser(photosGroupedByUser) {
  return photosGroupedByUser.flatMap((el) => el.photos);
}
