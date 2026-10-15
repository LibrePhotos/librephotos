import i18n from "../../i18n";
import { toast } from "./toast";

function serviceActionSuccess(message: string) {
  toast.success(message, { title: i18n.t("services.name") });
}

/** The server serves again after BackendStatusGate showed it down or updating (#2310). */
function backendBack() {
  toast.success(i18n.t("backendStatus.back.message"), { title: i18n.t("backendStatus.back.title") });
}

export const services = {
  backendBack,
  serviceActionSuccess,
};
