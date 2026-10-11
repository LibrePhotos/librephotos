import i18n from "../../i18n";
import { toast } from "./toast";

function createTag(name: string) {
  toast.success(i18n.t("toasts.createtag", { name }), { title: i18n.t("toasts.createtagtitle") });
}

function renameTag(oldName: string, newName: string) {
  toast.success(i18n.t("toasts.renametag", { oldName, newName }), { title: i18n.t("toasts.renametagtitle") });
}

function deleteTag(name: string) {
  toast.success(i18n.t("toasts.deletetag", { name }), { title: i18n.t("toasts.deletetagtitle") });
}

function mergeTags(sourceName: string, name: string) {
  toast.success(i18n.t("toasts.mergetags", { sourceName, name }), { title: i18n.t("toasts.mergetagstitle") });
}

function addPhotosToTag(name: string, numberOfPhotos: number) {
  toast.success(i18n.t("toasts.addtotag", { name, numberOfPhotos }), { title: i18n.t("toasts.addtotagtitle") });
}

function removePhotosFromTag(name: string, numberOfPhotos: number) {
  toast.success(i18n.t("toasts.removefromtag", { name, numberOfPhotos }), {
    title: i18n.t("toasts.removefromtagtitle"),
  });
}

function taggedPhotos(names: string[], numberOfPhotos: number) {
  toast.success(
    i18n.t("toasts.taggedphotos", {
      tags: names.join(", "),
      count: numberOfPhotos,
    }),
    { title: i18n.t("toasts.taggedphotostitle") }
  );
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
