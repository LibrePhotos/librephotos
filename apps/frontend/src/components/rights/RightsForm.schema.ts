import { PhotoLicenseId, type PhotoRightsUpdate } from "@librephotos/api-client";
import type { TFunction } from "i18next";
import { z } from "zod";

/** The server's limit for a creator (`PhotoMetadata.creator`). */
const CREATOR_MAX_LENGTH = 200;

/** The rights editor of one photo (#425): two texts and a license, each may be empty. */
export function makeRightsFormSchema(t: TFunction) {
  return z.object({
    copyright: z.string(),
    creator: z.string().max(CREATOR_MAX_LENGTH, t("rights.creatorTooLong", { max: CREATOR_MAX_LENGTH })),
    license: PhotoLicenseId.nullable(),
  });
}

export type RightsFormValues = z.infer<ReturnType<typeof makeRightsFormSchema>>;

/**
 * The fields that differ from `saved`, as the API takes them: empty text is none (null). A field left
 * as it was is left out, so it keeps each photo's value.
 */
export function changedRights(values: RightsFormValues, saved: RightsFormValues): PhotoRightsUpdate {
  const update: PhotoRightsUpdate = {};
  const copyright = values.copyright.trim();
  const creator = values.creator.trim();
  if (copyright !== saved.copyright) update.copyright = copyright || null;
  if (creator !== saved.creator) update.creator = creator || null;
  if (values.license !== saved.license) update.license = values.license;
  return update;
}
