import type { TFunction } from "i18next";
import { z } from "zod";
import { newName } from "../../util/formSchemas";

/** An album title: the rename dialog of the album hub and My Albums, and the New album dialog. */
export function makeAlbumTitleSchema(t: TFunction, existingTitles: Iterable<string>) {
  return z.object({
    title: newName(existingTitles, {
      blank: t("errornameblank"),
      taken: name => t("useralbum.albumalreadyexists", { name }),
    }),
  });
}
