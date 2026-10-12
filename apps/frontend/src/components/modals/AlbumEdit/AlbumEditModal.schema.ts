import type { TFunction } from "i18next";
import { z } from "zod";
import { newName } from "../../../util/formSchemas";

/** "New album" in the add-to-album dialog. The server refuses a blank title (400). */
export function makeNewAlbumSchema(t: TFunction, existingTitles: Iterable<string>) {
  return z.object({
    title: newName(existingTitles, {
      blank: t("errornameblank"),
      taken: title => t("modalalbum.alreadyexists", { title }),
    }),
  });
}
