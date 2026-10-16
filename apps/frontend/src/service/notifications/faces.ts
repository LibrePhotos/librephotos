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

/** Face detection started again in some photos (`count`) or in a folder (null) (#524). */
function detectFacesAgain(count: number | null) {
  const message = count === null ? i18n.t("toasts.detectfacesfolder") : i18n.t("toasts.detectfacesphotos", { count });
  toast.success(message, { title: i18n.t("toasts.detectfacestitle") });
}

/** Face detection did not start again; `message` says why. */
function detectFacesAgainFailed(message: string) {
  toast.error(message, { title: i18n.t("toasts.detectfacestitle") });
}

function rescanFacesFailed() {
  toast.error(i18n.t("toasts.rescanfacesfailed"), { title: i18n.t("toasts.rescanfacestitle") });
}

// The face actions run once per face on the dashboard (#599): these toasts add up while on screen.
// Each takes the undo of its action (#127), which gives the toast an Undo button.

type Undo = () => Promise<unknown>;

function deleteFaces(numberOfFaces: number, undo?: Undo) {
  toast.successCounted(
    "faces-deleted",
    numberOfFaces,
    total => i18n.t("toasts.deletefaces", { numberOfFaces: total }),
    { title: i18n.t("toasts.deletefacestitle"), undo }
  );
}

function addFacesToPerson(personName: string, numberOfFaces: number, undo?: Undo) {
  toast.successCounted(
    `faces-labeled-${personName}`,
    numberOfFaces,
    total => i18n.t("toasts.addfacestoperson", { numberOfFaces: total, personName }),
    { title: i18n.t("toasts.addfacestopersontitle"), undo }
  );
}

function removeFacesFromPerson(numberOfFaces: number, undo?: Undo) {
  toast.successCounted(
    "faces-unlabeled",
    numberOfFaces,
    total => i18n.t("toasts.removefacestoperson", { numberOfFaces: total }),
    { title: i18n.t("toasts.removefacestopersontitle"), undo }
  );
}

/** Deleted faces are back with their people: from the Deleted tab, or the Undo of a delete. */
function restoreFaces(numberOfFaces: number) {
  toast.successCounted("faces-restored", numberOfFaces, total => i18n.t("toasts.restorefaces", { count: total }), {
    title: i18n.t("toasts.restorefacestitle"),
  });
}

/** The Undo of a labelling: the faces are back with the people they had. */
function restoreFaceLabels(numberOfFaces: number) {
  toast.successCounted(
    "faces-labels-restored",
    numberOfFaces,
    total => i18n.t("toasts.restorefacelabels", { count: total }),
    { title: i18n.t("toasts.restorefacelabelstitle") }
  );
}

export const faces = {
  addFacesToPerson,
  deleteFaces,
  detectFacesAgain,
  detectFacesAgainFailed,
  removeFacesFromPerson,
  rescanFaces,
  rescanFacesFailed,
  restoreFaceLabels,
  restoreFaces,
  trainFaces,
  trainFacesFailed,
};
