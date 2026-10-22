import type { TFunction } from "i18next";
import { z } from "zod";

/** "Every user" in the users select; any other value is a user id. */
export const ALL_USERS = "all";

/**
 * The scope of Check file contents (#2040): every user or one, and for one user optionally a folder
 * relative to their scan directory. The server checks the folder is inside it; this only refuses a
 * ".." step, which can never be.
 */
export function makeCheckFileContentsSchema(t: TFunction) {
  return z.object({
    userId: z.string(),
    folder: z
      .string()
      .trim()
      .refine(folder => !folder.split(/[\\/]/).includes(".."), { message: t("checkfilecontents.folderinvalid") }),
  });
}
