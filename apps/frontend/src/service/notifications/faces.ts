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

// The face actions run once per face on the dashboard (#599): these toasts add up while on screen

function deleteFaces(numberOfFaces: number) {
  toast.successCounted(
    "faces-deleted",
    numberOfFaces,
    total => i18n.t("toasts.deletefaces", { numberOfFaces: total }),
    {
      title: i18n.t("toasts.deletefacestitle"),
    }
  );
}

function addFacesToPerson(personName: string, numberOfFaces: number) {
  toast.successCounted(
    `faces-labeled-${personName}`,
    numberOfFaces,
    total => i18n.t("toasts.addfacestoperson", { numberOfFaces: total, personName }),
    { title: i18n.t("toasts.addfacestopersontitle") }
  );
}

function removeFacesFromPerson(numberOfFaces: number) {
  toast.successCounted(
    "faces-unlabeled",
    numberOfFaces,
    total => i18n.t("toasts.removefacestoperson", { numberOfFaces: total }),
    { title: i18n.t("toasts.removefacestopersontitle") }
  );
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
