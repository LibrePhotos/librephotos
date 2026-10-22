import type { TFunction } from "i18next";
import { z } from "zod";

/** Sharing my library (#2731): who with, and the five switches (all off unless turned on). */
export function makeShareLibrarySchema(t: TFunction) {
  return z.object({
    recipientId: z.string().min(1, { error: t("librarySharing.chooseRecipient") }),
    share_location: z.boolean(),
    share_faces: z.boolean(),
    share_camera_info: z.boolean(),
    share_captions: z.boolean(),
    share_originals: z.boolean(),
  });
}

export type ShareLibraryValues = z.infer<ReturnType<typeof makeShareLibrarySchema>>;
