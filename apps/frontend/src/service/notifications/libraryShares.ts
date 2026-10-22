import i18n from "../../i18n";
import { toast } from "./toast";

function libraryShared(name: string) {
  toast.success(i18n.t("librarySharing.toastShared", { name }), { title: i18n.t("librarySharing.toastSharedTitle") });
}

function libraryShareStopped(name: string) {
  toast.success(i18n.t("librarySharing.toastStopped", { name }), {
    title: i18n.t("librarySharing.toastStoppedTitle"),
  });
}

function libraryLeft(name: string) {
  toast.success(i18n.t("librarySharing.toastLeft", { name }), { title: i18n.t("librarySharing.toastLeftTitle") });
}

export const libraryShares = {
  libraryShared,
  libraryShareStopped,
  libraryLeft,
};
