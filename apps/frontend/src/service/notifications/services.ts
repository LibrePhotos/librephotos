import { showNotification } from "@mantine/notifications";

function serviceActionSuccess(message: string) {
  showNotification({
    message,
    title: "Service",
    color: "teal",
  });
}

export const services = {
  serviceActionSuccess,
};
