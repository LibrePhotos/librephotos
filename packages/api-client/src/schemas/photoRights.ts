import { z } from "zod";

/**
 * The licenses a photo can carry (#425), by the id the server stores (`PhotoLicense` in
 * `apps/backend/api/models/photo_license.py`), in the order a picker lists them.
 */
export const PhotoLicenseId = z.enum([
  "all-rights-reserved",
  "cc-by-4.0",
  "cc-by-sa-4.0",
  "cc-by-nc-4.0",
  "cc-by-nc-sa-4.0",
  "cc-by-nd-4.0",
  "cc-by-nc-nd-4.0",
  "cc0-1.0",
  "pdm-1.0",
]);
export type PhotoLicenseId = z.infer<typeof PhotoLicenseId>;

/**
 * The deed of each license; null for "All rights reserved". The list is closed: a client links only
 * to these URLs, never to one a file or a user gave.
 */
const PHOTO_LICENSE_URLS: Readonly<Record<PhotoLicenseId, string | null>> = {
  "all-rights-reserved": null,
  "cc-by-4.0": "https://creativecommons.org/licenses/by/4.0/",
  "cc-by-sa-4.0": "https://creativecommons.org/licenses/by-sa/4.0/",
  "cc-by-nc-4.0": "https://creativecommons.org/licenses/by-nc/4.0/",
  "cc-by-nc-sa-4.0": "https://creativecommons.org/licenses/by-nc-sa/4.0/",
  "cc-by-nd-4.0": "https://creativecommons.org/licenses/by-nd/4.0/",
  "cc-by-nc-nd-4.0": "https://creativecommons.org/licenses/by-nc-nd/4.0/",
  "cc0-1.0": "https://creativecommons.org/publicdomain/zero/1.0/",
  "pdm-1.0": "https://creativecommons.org/publicdomain/mark/1.0/",
};

/** The deed of a license; null for "All rights reserved". */
export function photoLicenseUrl(id: PhotoLicenseId): string | null {
  return PHOTO_LICENSE_URLS[id];
}

/** The rights fields of a photo: its copyright notice, its creator and its license. */
export const RightsField = z.enum(["copyright", "creator", "license"]);
export type RightsField = z.infer<typeof RightsField>;

/**
 * What a change of many photos' rights leaves alone: `any` value a photo has (only empty fields are
 * filled), the values its `file` gives, or `none`.
 */
export type RightsKeep = "any" | "file" | "none";

/** The rights a "Set rights…" request sets; a field left out stays, null clears it. */
export type PhotoRightsUpdate = {
  copyright?: string | null;
  creator?: string | null;
  license?: PhotoLicenseId | null;
};

/**
 * A photo's rights as visitors and other users see them (#425): its license (a `PhotoLicenseId`,
 * narrowed by the client), creator and copyright notice, each null when not stated.
 */
export const PhotoRights = z.object({
  license: z.string().nullable(),
  creator: z.string().nullable(),
  copyright: z.string().nullable(),
});
export type PhotoRights = z.infer<typeof PhotoRights>;

/** `POST /photos/rights/`: the photos whose rights changed, and those that kept a value of theirs. */
export const SetPhotosRightsResponse = z.object({
  count: z.number(),
  kept: z.number(),
});
export type SetPhotosRightsResponse = z.infer<typeof SetPhotosRightsResponse>;

/** One rights field of a selection: its value when every photo has the same one, else `mixed`. */
export const RightsFieldSummary = z.object({
  value: z.string().nullable(),
  mixed: z.boolean(),
});
export type RightsFieldSummary = z.infer<typeof RightsFieldSummary>;

/** `POST /photos/rights-summary/`: a selection's rights before "Set rights…" changes them. */
export const RightsSummaryResponse = z.object({
  count: z.number(),
  from_file: z.number(),
  copyright: RightsFieldSummary,
  creator: RightsFieldSummary,
  license: RightsFieldSummary,
});
export type RightsSummaryResponse = z.infer<typeof RightsSummaryResponse>;

/** `GET /photos/rights/apply-default/`: my photos, and those missing a field the default sets. */
export const RightsDefaultCountsResponse = z.object({
  total: z.number(),
  missing: z.number(),
});
export type RightsDefaultCountsResponse = z.infer<typeof RightsDefaultCountsResponse>;
