import i18n from "../../i18n";
import { toast } from "./toast";

function trainFaces() {
  toast.success(i18n.t("toasts.trainingstarted"), { title: i18n.t("toasts.trainingstartedtitle") });
}

function trainFacesFailed() {
  toast.error(i18n.t("toasts.trainingfailed"), { title: i18n.t("toasts.trainingstartedtitle") });
}

function rescanFaces() {
  toast.success(i18n.t("toasts.rescanfaces"), { title: i18n.t("toasts.rescanfacestitle") });
}

function rescanFacesFailed() {
  toast.error(i18n.t("toasts.rescanfacesfailed"), { title: i18n.t("toasts.rescanfacestitle") });
}

function deleteFaces(numberOfFaces: number) {
  toast.success(i18n.t("toasts.deletefaces", { numberOfFaces }), { title: i18n.t("toasts.deletefacestitle") });
}

function addFacesToPerson(personName: string, numberOfFaces: number) {
  toast.success(i18n.t("toasts.addfacestoperson", { numberOfFaces, personName }), {
    title: i18n.t("toasts.addfacestopersontitle"),
  });
}

function removeFacesFromPerson(numberOfFaces: number) {
  toast.success(i18n.t("toasts.removefacestoperson", { numberOfFaces }), {
    title: i18n.t("toasts.removefacestopersontitle"),
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
