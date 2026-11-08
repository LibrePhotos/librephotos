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

// One short sentence with no title. `numberOfPhotos` is passed beside `count` for the translations
// that still read "{{numberOfPhotos}} photo(s)".

function addPhotosToTag(name: string, count: number) {
  toast.success(i18n.t("toasts.addtotag", { name, count, numberOfPhotos: count }));
}

function removePhotosFromTag(name: string, count: number) {
  toast.success(i18n.t("toasts.removefromtag", { name, count, numberOfPhotos: count }));
}

function taggedPhotos(names: string[], count: number) {
  toast.success(i18n.t("toasts.taggedphotos", { tags: names.join(", "), count }));
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
