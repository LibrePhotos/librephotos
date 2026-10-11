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

export const people = {
  deletePerson,
  renamePerson,
};
