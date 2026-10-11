import i18n from "../../i18n";
import { toast } from "./toast";

function updateUser(username: string) {
  toast.success(i18n.t("toasts.updateuser", { username }), { title: i18n.t("toasts.updateusertitle") });
}

function updateUserError(message?: string) {
  toast.error(message || i18n.t("toasts.updateusererror"), { title: i18n.t("toasts.updateusererrortitle") });
}

function deleteUser(username: string) {
  toast.success(i18n.t("toasts.deleteuser", { username }), { title: i18n.t("toasts.deleteusertitle") });
}

function signupError(message?: string) {
  toast.error(message || i18n.t("toasts.signuperror"), { title: i18n.t("toasts.signuperrortitle") });
}

export const user = {
  deleteUser,
  updateUser,
  updateUserError,
  signupError,
};
