import type { TFunction } from "i18next";
import { z } from "zod";

/** The "Add folder" dialog (#123). `isPathValid`: the picker found the typed folder. */
export function makeAddLibraryFolderSchema(t: TFunction, isPathValid: boolean) {
  return z.object({
    path: z
      .string()
      .trim()
      .min(1, { error: t("libraryfolders.pathrequired") })
      .refine(() => isPathValid, { error: t("modalscandirectoryedit.pathdoesnotexist") }),
  });
}
