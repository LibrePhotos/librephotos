import i18n from "../../i18n";
import { toast } from "./toast";

function renamePerson(oldName: string, newName: string) {
  toast.success(i18n.t("toasts.renameperson", { personName: oldName, newPersonName: newName }), {
    title: i18n.t("toasts.renamepersontitle"),
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

/** The faces are saved; their tags did not reach some files (a read-only library). */
function faceTagsNotWritten(error: string) {
  toast.warning(i18n.t("toasts.facetagsnotwritten", { error }), {
    title: i18n.t("toasts.facetagsnotwrittentitle"),
  });
}

export const people = {
  deletePerson,
  faceTagsNotWritten,
  removePhotosFromPerson,
  renamePerson,
};
