import i18n from "../../i18n";
import { toast } from "./toast";

/** The counts a move reports (#352): photos moved, and those that stayed where they were. */
type MoveCounts = Readonly<{ moved: number; skipped: number; refused: number; failed: number }>;

/** A large selection moves in the background, in the "Move Photos" job. */
function movePhotosStarted() {
  toast.success(i18n.t("toasts.movephotosstarted"), { title: i18n.t("toasts.movephotostitle") });
}

/** What a move did: done, partly done (some photos stayed) or nothing moved. `folder` is the folder's name. */
function photosMoved({ moved, skipped, refused, failed }: MoveCounts, folder: string) {
  const title = i18n.t("toasts.movephotostitle");
  const stayed = skipped + refused + failed;
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

export const moves = { movePhotosStarted, photosMoved, photosMoveFailed };
