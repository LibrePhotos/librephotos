import type { TFunction } from "i18next";
import { z } from "zod";
import { newName } from "../../util/formSchemas";

/** The rename dialog of the album hub and My Albums. */
export function makeAlbumRenameSchema(t: TFunction, existingTitles: Iterable<string>) {
  return z.object({
    title: newName(existingTitles, {
      blank: t("errornameblank"),
      taken: name => t("useralbum.albumalreadyexists", { name }),
    }),
  });
}
