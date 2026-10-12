import type { TFunction } from "i18next";
import { z } from "zod";

/** The merge-tags dialog: the id of the tag merged into the target. */
export function makeTagMergeSchema(t: TFunction) {
  return z.object({
    source: z.string({ error: t("tagalbum.errorchoosetag") }).min(1, { error: t("tagalbum.errorchoosetag") }),
  });
}
