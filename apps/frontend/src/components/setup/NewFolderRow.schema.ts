import type { TFunction } from "i18next";
import { z } from "zod";

/**
 * A new folder's name (#2035): one folder, so no separator and not `.` or `..`. The server checks
 * the rest (names Windows refuses) and says why.
 */
export function makeNewFolderSchema(t: TFunction) {
  return z.object({
    name: z
      .string()
      .refine(name => name.trim() !== "", t("directorypicker.nameblank"))
      .refine(name => !/[/\\]/.test(name) && name !== "." && name !== "..", t("directorypicker.nameinvalid")),
  });
}
