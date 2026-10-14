import type { TFunction } from "i18next";
import { z } from "zod";
import { newName } from "../../util/formSchemas";

/** A new or renamed album collection: not blank, and not a name the user already has (any case). */
export function makeAlbumCollectionNameSchema(t: TFunction, existingNames: Iterable<string>) {
  return z.object({
    name: newName(existingNames, {
      blank: t("errornameblank"),
      taken: name => t("albumcollections.alreadyexists", { name }),
    }),
  });
}
