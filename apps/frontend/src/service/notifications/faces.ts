import { showNotification } from "@mantine/notifications";
import i18n from "../../i18n";

function trainFaces() {
  showNotification({
    message: i18n.t("toasts.trainingstarted"),
    title: i18n.t("toasts.trainingstartedtitle"),
    color: "teal",
  });
}

function trainFacesFailed() {
  showNotification({
    message: i18n.t("toasts.trainingfailed"),
    title: i18n.t("toasts.trainingstartedtitle"),
    color: "red",
  });
}

function rescanFaces() {
  showNotification({
    message: i18n.t("toasts.rescanfaces"),
    title: i18n.t("toasts.rescanfacestitle"),
    color: "teal",
  });
}

function rescanFacesFailed() {
  showNotification({
    message: i18n.t("toasts.rescanfacesfailed"),
    title: i18n.t("toasts.rescanfacestitle"),
    color: "red",
  });
}

function deleteFaces(numberOfFaces: number) {
  showNotification({
    message: i18n.t("toasts.deletefaces", { numberOfFaces }),
    title: i18n.t("toasts.deletefacestitle"),
    color: "teal",
  });
}

function addFacesToPerson(personName: string, numberOfFaces: number) {
  showNotification({
    message: i18n.t("toasts.addfacestoperson", { numberOfFaces, personName }),
    title: i18n.t("toasts.addfacestopersontitle"),
    color: "teal",
  });
}

function removeFacesFromPerson(numberOfFaces: number) {
  showNotification({
    message: i18n.t("toasts.removefacestoperson", { numberOfFaces }),
    title: i18n.t("toasts.removefacestopersontitle"),
    color: "teal",
  });
}

export const faces = {
  addFacesToPerson,
  deleteFaces,
  removeFacesFromPerson,
  rescanFaces,
  rescanFacesFailed,
  trainFaces,
  trainFacesFailed,
};
