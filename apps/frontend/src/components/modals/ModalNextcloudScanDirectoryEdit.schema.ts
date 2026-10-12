import type { TFunction } from "i18next";
import { z } from "zod";

/** The Nextcloud scan directory dialog. */
export function makeNextcloudScanDirectorySchema(t: TFunction) {
  return z.object({
    directory: z
      .string()
      .trim()
      .min(1, { error: t("modalscandirectoryedit.mustspecifypath") }),
  });
}
