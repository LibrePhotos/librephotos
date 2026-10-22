import type { TFunction } from "i18next";
import { z } from "zod";

/** A person's birth date (#2750): a `YYYY-MM-DD` day no later than `today`, or none. */
export function makePersonBirthDateSchema(t: TFunction, today: string) {
  return z.object({
    // Both are YYYY-MM-DD, so they compare as strings
    birthDate: z
      .string()
      .nullable()
      .refine(day => day === null || day <= today, { message: t("personbirthdate.errorfuture") }),
  });
}
