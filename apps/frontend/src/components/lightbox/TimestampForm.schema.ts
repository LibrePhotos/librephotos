import type { TFunction } from "i18next";
import { z } from "zod";
import { isWholeTime } from "../../util/dateUtils";

/** The info panel's date editor: a day and a whole time, so an emptied time is never midnight (#2280). */
export function makeTimestampFormSchema(t: TFunction) {
  return z.object({
    day: z.string().refine(day => day !== "", t("lightbox.sidebar.pickday")),
    time: z.string().refine(isWholeTime, t("lightbox.sidebar.timeincomplete")),
  });
}
