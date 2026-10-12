import type { TFunction } from "i18next";
import { z } from "zod";
import { newName } from "../../util/formSchemas";

/**
 * A person's new name: the rename dialogs of the people page and the faces dashboard, and "New
 * person" in the face labelling dialog.
 */
export function makePersonNameSchema(t: TFunction, existingNames: Iterable<string>) {
  return z.object({
    name: newName(existingNames, {
      blank: t("errornameblank"),
      taken: name => t("personalbum.personalreadyexists", { name }),
    }),
  });
}
