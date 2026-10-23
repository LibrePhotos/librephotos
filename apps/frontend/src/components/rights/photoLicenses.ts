import { PhotoLicenseId } from "@librephotos/api-client";
import {
  IconCopyright,
  IconCopyrightOff,
  IconCreativeCommons,
  IconCreativeCommonsBy,
  IconCreativeCommonsNc,
  IconCreativeCommonsNd,
  IconCreativeCommonsSa,
  IconCreativeCommonsZero,
  type Icon,
} from "@tabler/icons-react";
import type { ParseKeys } from "i18next";

/** How the license picker groups the licenses. */
export type LicenseGroup = "reserved" | "creativeCommons" | "publicDomain";

/**
 * What a license lets others do, for the "what you may do" rows of a public page. None for all rights
 * reserved: nothing without asking.
 */
export type LicenseTerms = Readonly<{
  /** Change the photo (crop, edit, use it in a collage). */
  adapt: boolean;
  /** Use it for something sold or advertised. */
  commercial: boolean;
  /** Name the creator and link the license. */
  credit: boolean;
  /** Put an adaptation under the same license. */
  shareAlike: boolean;
}>;

const terms = (adapt: boolean, commercial: boolean, credit: boolean, shareAlike: boolean): LicenseTerms => ({
  adapt,
  commercial,
  credit,
  shareAlike,
});

type LicenseInfo = Readonly<{
  /** The short name ("CC BY-NC 4.0"). */
  name: ParseKeys;
  /** The full name ("Attribution-NonCommercial 4.0 International"). */
  title: ParseKeys;
  /** One sentence a visitor reads: what they may do with the photo. */
  summary: ParseKeys;
  group: LicenseGroup;
  /** The Creative Commons marks, shown next to the name; decorative, the name says it. */
  icons: readonly Icon[];
  terms: LicenseTerms | null;
}>;

const CC_BY = [IconCreativeCommons, IconCreativeCommonsBy] as const;

/** What the app shows for each license (#425); the deed URLs come from `photoLicenseUrl`. */
export const LICENSES: Readonly<Record<PhotoLicenseId, LicenseInfo>> = {
  "all-rights-reserved": {
    name: "rights.licenses.allRightsReserved.name",
    title: "rights.licenses.allRightsReserved.title",
    summary: "rights.licenses.allRightsReserved.summary",
    group: "reserved",
    icons: [IconCopyright],
    terms: null,
  },
  "cc-by-4.0": {
    name: "rights.licenses.ccBy.name",
    title: "rights.licenses.ccBy.title",
    summary: "rights.licenses.ccBy.summary",
    group: "creativeCommons",
    icons: CC_BY,
    terms: terms(true, true, true, false),
  },
  "cc-by-sa-4.0": {
    name: "rights.licenses.ccBySa.name",
    title: "rights.licenses.ccBySa.title",
    summary: "rights.licenses.ccBySa.summary",
    group: "creativeCommons",
    icons: [...CC_BY, IconCreativeCommonsSa],
    terms: terms(true, true, true, true),
  },
  "cc-by-nc-4.0": {
    name: "rights.licenses.ccByNc.name",
    title: "rights.licenses.ccByNc.title",
    summary: "rights.licenses.ccByNc.summary",
    group: "creativeCommons",
    icons: [...CC_BY, IconCreativeCommonsNc],
    terms: terms(true, false, true, false),
  },
  "cc-by-nc-sa-4.0": {
    name: "rights.licenses.ccByNcSa.name",
    title: "rights.licenses.ccByNcSa.title",
    summary: "rights.licenses.ccByNcSa.summary",
    group: "creativeCommons",
    icons: [...CC_BY, IconCreativeCommonsNc, IconCreativeCommonsSa],
    terms: terms(true, false, true, true),
  },
  "cc-by-nd-4.0": {
    name: "rights.licenses.ccByNd.name",
    title: "rights.licenses.ccByNd.title",
    summary: "rights.licenses.ccByNd.summary",
    group: "creativeCommons",
    icons: [...CC_BY, IconCreativeCommonsNd],
    terms: terms(false, true, true, false),
  },
  "cc-by-nc-nd-4.0": {
    name: "rights.licenses.ccByNcNd.name",
    title: "rights.licenses.ccByNcNd.title",
    summary: "rights.licenses.ccByNcNd.summary",
    group: "creativeCommons",
    icons: [...CC_BY, IconCreativeCommonsNc, IconCreativeCommonsNd],
    terms: terms(false, false, true, false),
  },
  "cc0-1.0": {
    name: "rights.licenses.cc0.name",
    title: "rights.licenses.cc0.title",
    summary: "rights.licenses.cc0.summary",
    group: "publicDomain",
    icons: [IconCreativeCommonsZero],
    terms: terms(true, true, false, false),
  },
  "pdm-1.0": {
    name: "rights.licenses.pdm.name",
    title: "rights.licenses.pdm.title",
    summary: "rights.licenses.pdm.summary",
    group: "publicDomain",
    icons: [IconCopyrightOff],
    terms: terms(true, true, false, false),
  },
};

export const LICENSE_GROUP_KEYS: Readonly<Record<LicenseGroup, ParseKeys>> = {
  reserved: "rights.groups.reserved",
  creativeCommons: "rights.groups.creativeCommons",
  publicDomain: "rights.groups.publicDomain",
};

/** A stored license value as one the app knows; anything else (an older or newer server's) is none. */
export function asLicense(value: string | null | undefined): PhotoLicenseId | null {
  const parsed = PhotoLicenseId.safeParse(value);
  return parsed.success ? parsed.data : null;
}
