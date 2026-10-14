import type { TFunction } from "i18next";
import { z } from "zod";

/** An end of a range as a NumberInput holds it: a number, or "" while empty. */
const end = z.union([z.number().min(0), z.literal("")]);

/** One number range of the search filters: either end may be empty, the lowest not above the highest. */
export function makeRangeFilterSchema(t: TFunction) {
  return z.object({ low: end, high: end }).refine(({ low, high }) => low === "" || high === "" || low <= high, {
    message: t("searchfilter.rangeerror"),
    path: ["high"],
  });
}

export type RangeFilterValues = z.infer<ReturnType<typeof makeRangeFilterSchema>>;
