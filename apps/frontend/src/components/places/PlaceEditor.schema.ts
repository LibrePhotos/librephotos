import { USER_PLACE_ICONS } from "@librephotos/api-client";
import type { TFunction } from "i18next";
import { z } from "zod";
import { newName } from "../../util/formSchemas";

/** A place's name, icon and title switch (#1365): a name the user has for no other place. */
export function makePlaceEditorSchema(t: TFunction, existingNames: Iterable<string>) {
  return z.object({
    name: newName(existingNames, {
      blank: t("yourplaces.editor.nameRequired"),
      taken: name => t("yourplaces.editor.nameTaken", { name }),
    }),
    icon: z.enum(USER_PLACE_ICONS),
    useInTitles: z.boolean(),
  });
}
