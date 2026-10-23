import type { RightsFieldSummary, RightsSummaryResponse } from "@librephotos/api-client";
import type { TFunction } from "i18next";
import { z } from "zod";
import { asLicense } from "./photoLicenses";
import { makeRightsFormSchema } from "./RightsForm.schema";

/** "Set rights…" (#425): the rights editor's fields, and whether to change values that came from files. */
export function makeSetRightsSchema(t: TFunction) {
  return makeRightsFormSchema(t).extend({ replaceFileValues: z.boolean() });
}

type SetRightsValues = z.infer<ReturnType<typeof makeSetRightsSchema>>;

/** A field's starting text: the selection's common value, empty when it is mixed or unset. */
const common = (field: RightsFieldSummary) => (field.mixed ? "" : (field.value ?? ""));

/** The form as it opens: each field shows the value every photo shares. */
export function initialSetRights(summary: RightsSummaryResponse): SetRightsValues {
  return {
    copyright: common(summary.copyright),
    creator: common(summary.creator),
    license: asLicense(common(summary.license)),
    replaceFileValues: false,
  };
}
