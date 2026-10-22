import i18n from "../../i18n";
import { toast } from "./toast";

function renamePerson(oldName: string, newName: string) {
  toast.success(i18n.t("toasts.renameperson", { personName: oldName, newPersonName: newName }), {
    title: i18n.t("toasts.renamepersontitle"),
  });
}

/** A person's birth date was saved, or removed (#2750). */
function personBirthDate(name: string, saved: boolean) {
  toast.success(i18n.t(saved ? "toasts.personbirthdatesaved" : "toasts.personbirthdateremoved", { name }), {
    title: i18n.t("toasts.personbirthdatetitle"),
  });
}

function deletePerson() {
  toast.success(i18n.t("toasts.deleteperson"), { title: i18n.t("toasts.deletepersontitle") });
}

function removePhotosFromPerson(name: string, count: number) {
  toast.success(i18n.t("toasts.removefromperson", { count }), {
    title: i18n.t("toasts.removefrompersontitle", { name }),
  });
}

function mergePerson(sourceName: string, targetName: string) {
  toast.success(i18n.t("toasts.mergeperson", { sourceName, targetName }), {
    title: i18n.t("toasts.mergepersontitle"),
  });
}

/** The faces are saved; their tags did not reach some files (a read-only library). */
function faceTagsNotWritten(error: string) {
  toast.warning(i18n.t("toasts.facetagsnotwritten", { error }), {
    title: i18n.t("toasts.facetagsnotwrittentitle"),
  });
}

function createPersonGroup(name: string) {
  toast.success(i18n.t("toasts.createpersongroup", { name }), { title: i18n.t("toasts.persongrouptitle") });
}

function renamePersonGroup(oldName: string, newName: string) {
  toast.success(i18n.t("toasts.renamepersongroup", { oldName, newName }), {
    title: i18n.t("toasts.persongrouptitle"),
  });
}

function deletePersonGroup(name: string) {
  toast.success(i18n.t("toasts.deletepersongroup", { name }), { title: i18n.t("toasts.persongrouptitle") });
}

export const people = {
  createPersonGroup,
  deletePerson,
  deletePersonGroup,
  faceTagsNotWritten,
  mergePerson,
  personBirthDate,
  removePhotosFromPerson,
  renamePerson,
  renamePersonGroup,
};
