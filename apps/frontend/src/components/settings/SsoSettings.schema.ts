import type { TFunction } from "i18next";
import { z } from "zod";

/** The server refuses longer labels (api/serializers/site_settings.py). */
export const MAX_SSO_LABEL = 64;

/** The single sign-on button label in the Site Settings card; saved trimmed. */
export function makeSsoLabelSchema(t: TFunction) {
  return z.object({
    label: z
      .string()
      .trim()
      .max(MAX_SSO_LABEL, { error: t("sitesettings.sso_label_too_long", { max: MAX_SSO_LABEL }) }),
  });
}
