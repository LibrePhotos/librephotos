import i18n from "../../i18n";
import { toast } from "./toast";

/** The counts a move reports (#352): photos moved, and those that stayed where they were. */
type MoveCounts = Readonly<{ moved: number; skipped: number; refused: number; failed: number; undated?: number }>;

/** A large selection moves in the background, in the "Move Photos" job. */
function movePhotosStarted() {
  toast.success(i18n.t("toasts.movephotosstarted"), { title: i18n.t("toasts.movephotostitle") });
}

/** What a move did: done, partly done (some photos stayed) or nothing moved. `folder` is the folder's name. */
function photosMoved({ moved, skipped, refused, failed, undated = 0 }: MoveCounts, folder: string) {
  const title = i18n.t("toasts.movephotostitle");
  const stayed = skipped + refused + failed + undated;
  const done = i18n.t("toasts.photosmoved", { count: moved, folder });
  if (stayed === 0) {
    toast.success(done, { title });
  } else if (moved > 0) {
    toast.warning(`${done} ${i18n.t("toasts.photosmovedstayed", { count: stayed })}`, { title, autoClose: false });
  } else {
    toast.warning(i18n.t("toasts.photosmovednone", { count: stayed }), { title, autoClose: false });
  }
}

/** The move was refused or failed; nothing moved. `reason` is the server's message. */
function photosMoveFailed(reason: string | null) {
  toast.error(reason ?? i18n.t("toasts.photosmovefailed"), { title: i18n.t("toasts.movephotostitle") });
}

/** The counts a rename reports (#2773). */
type RenameCounts = Readonly<{ renamed: number; unchanged: number; undated: number; refused: number; failed: number }>;

/** A large selection is renamed in the background, in the "Rename Photos" job. */
function renamePhotosStarted() {
  toast.success(i18n.t("toasts.renamephotosstarted"), { title: i18n.t("toasts.renamephotostitle") });
}

/**
 * What a rename did. Failed photos kept every file under its old name: that is said on its own,
 * and the toast stays until closed.
 */
function photosRenamed({ renamed, unchanged, undated, refused, failed }: RenameCounts) {
  const title = i18n.t("toasts.renamephotostitle");
  const kept = unchanged + undated + refused;
  const parts = [i18n.t("toasts.photosrenamed", { count: renamed })];
  if (kept > 0) parts.push(i18n.t("toasts.photosrenamedkept", { count: kept }));
  if (failed > 0) {
    parts.push(i18n.t("toasts.photosrenamedfailed", { count: failed }));
    toast.warning(parts.join(" "), { title, autoClose: false });
    return;
  }
  toast.success(parts.join(" "), { title });
}

/** The rename was refused or failed; nothing was renamed. `reason` is the server's message. */
function photosRenameFailed(reason: string | null) {
  toast.error(reason ?? i18n.t("toasts.photosrenamefailed"), { title: i18n.t("toasts.renamephotostitle") });
}

export const moves = {
  movePhotosStarted,
  photosMoved,
  photosMoveFailed,
  renamePhotosStarted,
  photosRenamed,
  photosRenameFailed,
};
