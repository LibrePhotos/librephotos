import type { TFunction } from "i18next";
import { z } from "zod";

export type NewFolderValues = { name: string };

/** A folder name the scan reads: no separator, not `.` or `..`, not hidden (a leading dot). */
const FOLDER_NAME = /^[^\\/.][^\\/]*$/;

/** A new folder's name, made inside the picked folder when the photos move. */
export function makeNewFolderSchema(t: TFunction) {
  return z.object({
    name: z.string().trim().min(1, t("movephotos.foldername")).regex(FOLDER_NAME, t("movephotos.badfoldername")),
  });
}
