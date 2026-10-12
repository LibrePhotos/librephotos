import type { TFunction } from "i18next";
import { z } from "zod";
import { newName } from "../../util/formSchemas";

/** The rename-tag dialog. */
export function makeTagRenameSchema(t: TFunction, existingNames: Iterable<string>) {
  return z.object({
    name: newName(existingNames, {
      blank: t("errornameblank"),
      taken: name => t("tagalbum.tagalreadyexists", { name }),
    }),
  });
}
