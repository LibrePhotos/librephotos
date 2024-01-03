import { showNotification } from "@mantine/notifications";

import i18n from "../../i18n";

function renamePerson(oldName: string, newName: string) {
  showNotification({
    message: i18n.t("toasts.renameperson", { personName: oldName, newPersonName: newName }),
    title: i18n.t("toasts.renamepersontitle"),
    color: "teal",
  });
}

function deletePerson() {
  showNotification({
    message: i18n.t("toasts.deleteperson"),
    title: i18n.t("toasts.deletepersontitle"),
    color: "teal",
  });
}

export const people = {
  deletePerson,
  renamePerson,
};
