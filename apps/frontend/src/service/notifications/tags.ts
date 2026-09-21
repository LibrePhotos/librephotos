import { showNotification } from "@mantine/notifications";
import i18n from "../../i18n";

function createTag(name: string) {
  showNotification({
    message: i18n.t("toasts.createtag", { name }),
    title: i18n.t("toasts.createtagtitle"),
    color: "teal",
  });
}

function renameTag(oldName: string, newName: string) {
  showNotification({
    message: i18n.t("toasts.renametag", { oldName, newName }),
    title: i18n.t("toasts.renametagtitle"),
    color: "teal",
  });
}

function deleteTag(name: string) {
  showNotification({
    message: i18n.t("toasts.deletetag", { name }),
    title: i18n.t("toasts.deletetagtitle"),
    color: "teal",
  });
}

function mergeTags(sourceName: string, name: string) {
  showNotification({
    message: i18n.t("toasts.mergetags", { sourceName, name }),
    title: i18n.t("toasts.mergetagstitle"),
    color: "teal",
  });
}

function addPhotosToTag(name: string, numberOfPhotos: number) {
  showNotification({
    message: i18n.t("toasts.addtotag", { name, numberOfPhotos }),
    title: i18n.t("toasts.addtotagtitle"),
    color: "teal",
  });
}

function removePhotosFromTag(name: string, numberOfPhotos: number) {
  showNotification({
    message: i18n.t("toasts.removefromtag", { name, numberOfPhotos }),
    title: i18n.t("toasts.removefromtagtitle"),
    color: "teal",
  });
}

function taggedPhotos(names: string[], numberOfPhotos: number) {
  showNotification({
    message: i18n.t("toasts.taggedphotos", {
      tags: names.join(", "),
      count: numberOfPhotos,
    }),
    title: i18n.t("toasts.taggedphotostitle"),
    color: "teal",
  });
}

export const tags = {
  addPhotosToTag,
  taggedPhotos,
  createTag,
  deleteTag,
  mergeTags,
  removePhotosFromTag,
  renameTag,
};
