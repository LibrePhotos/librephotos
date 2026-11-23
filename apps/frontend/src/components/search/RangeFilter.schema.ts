import type { TFunction } from "i18next";
import { z } from "zod";
import { parseExposureTime } from "../../util/exifFormat";

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

const isExposureTime = (text: string) => text.trim() === "" || parseExposureTime(text) !== undefined;

export function makeExposureTimeRangeSchema(t: TFunction) {
  const time = z.string().refine(isExposureTime, { message: t("searchfilter.exposuretimeerror") });
  return z.object({ low: time, high: time }).refine(
    ({ low, high }) => {
      const shortest = parseExposureTime(low);
      const longest = parseExposureTime(high);
      return shortest === undefined || longest === undefined || shortest <= longest;
    },
    { message: t("searchfilter.rangeerror"), path: ["high"] }
  );
}

export type ExposureTimeRangeValues = z.infer<ReturnType<typeof makeExposureTimeRangeSchema>>;
