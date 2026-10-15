import type { TFunction } from "i18next";
import { z } from "zod";
import { newName } from "../../util/formSchemas";

/** A new or renamed group of people: not blank, and not a name the user already has (any case). */
export function makePersonGroupNameSchema(t: TFunction, existingNames: Iterable<string>) {
  return z.object({
    name: newName(existingNames, {
      blank: t("errornameblank"),
      taken: name => t("persongroups.alreadyexists", { name }),
    }),
  });
}
