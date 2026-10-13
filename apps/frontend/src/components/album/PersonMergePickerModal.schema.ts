import type { TFunction } from "i18next";
import { z } from "zod";

/** The person page's "Merge into…" dialog: the id of the person to merge into. */
export function makePersonMergeSchema(t: TFunction) {
  return z.object({
    target: z
      .string({ error: t("personalbum.errorchooseperson") })
      .min(1, { error: t("personalbum.errorchooseperson") }),
  });
}
