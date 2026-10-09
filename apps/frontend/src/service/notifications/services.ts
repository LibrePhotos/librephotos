import { showNotification } from "@mantine/notifications";
import i18n from "../../i18n";

function serviceActionSuccess(message: string) {
  showNotification({
    message,
    title: i18n.t("services.name"),
    color: "teal",
  });
}

export const services = {
  serviceActionSuccess,
};
