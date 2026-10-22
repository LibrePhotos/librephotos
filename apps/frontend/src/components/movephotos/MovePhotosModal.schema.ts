import type { TFunction } from "i18next";
import { z } from "zod";

export type MovePhotosValues = {
  target: string;
  /** "Sort into folders by date" (#2774): each photo into the folder of its date inside `target`. */
  byDate: boolean;
  /** One of the folder presets; read only with `byDate`. */
  folderPattern: string;
};

/** An absolute server path: POSIX (`/photos`), a drive (`C:\photos`, `C:/photos`) or a share (`\\nas\photos`). */
const ABSOLUTE_PATH = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/;

/** The destination: a folder of the library, picked in the tree or typed. */
export function makeMovePhotosSchema(t: TFunction) {
  return z.object({
    target: z.string().trim().min(1, t("movephotos.pickfolder")).regex(ABSOLUTE_PATH, t("movephotos.absolutepath")),
    byDate: z.boolean(),
    folderPattern: z.string(),
  });
}
