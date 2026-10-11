import i18n from "../../i18n";
import { toast } from "./toast";

function serviceActionSuccess(message: string) {
  toast.success(message, { title: i18n.t("services.name") });
}

export const services = {
  serviceActionSuccess,
};
