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

/**
 * Faces labelled as `personName`, and `twins` faces labelled along with them: the same face in the
 * other frames of a burst or a duplicate group (#2754). The toast adds both up while on screen.
 */
function addFacesToPerson(personName: string, numberOfFaces: number, undo?: Undo, twins = 0) {
  toast.successCounted(
    `faces-labeled-${personName}`,
    numberOfFaces,
    (total, twinTotal = 0) => {
      const labelled = i18n.t("toasts.addfacestoperson", { numberOfFaces: total, personName });
      return twinTotal > 0 ? `${labelled}. ${i18n.t("toasts.addfacestwins", { count: twinTotal })}` : labelled;
    },
    { title: i18n.t("toasts.addfacestopersontitle"), undo, extra: twins }
  );
}

/** "Anna and Ben" in the UI language, English when the runtime does not know it. */
function listNames(names: readonly string[]): string {
  try {
    return new Intl.ListFormat(i18n.language, { type: "conjunction" }).format(names);
  } catch {
    return new Intl.ListFormat("en", { type: "conjunction" }).format(names);
  }
}

function removeFacesFromPerson(numberOfFaces: number, undo?: Undo) {
  toast.successCounted(
    "faces-unlabeled",
    numberOfFaces,
    total => i18n.t("toasts.removefacestoperson", { numberOfFaces: total }),
    { title: i18n.t("toasts.removefacestopersontitle"), undo }
  );
}

/**
 * "Not Anna": the faces went back to "Unknown - Other" and training no longer suggests the named
 * people `names` for them (#2747). Adds up with `removeFacesFromPerson`, the same toast.
 */
function rejectFacesFromPeople(names: readonly string[], numberOfFaces: number, undo?: Undo) {
  toast.successCounted(
    "faces-unlabeled",
    numberOfFaces,
    total => i18n.t("toasts.removefacesnotsuggested", { names: listNames(names), count: total }),
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
  rejectFacesFromPeople,
  removeFacesFromPerson,
  rescanFaces,
  rescanFacesFailed,
  restoreFaceLabels,
  restoreFaces,
  trainFaces,
  trainFacesFailed,
};
