import type { TFunction } from "i18next";
import { z } from "zod";
import { email, withMatchingPasswords } from "../util/formSchemas";

/** The sign-up form, on /signup and in the first-run setup on /login. */
export function makeSignupSchema(t: TFunction) {
  return withMatchingPasswords(
    z.object({
      username: z.string().min(1, { error: t("modaluseredit.errorusernamecannotbeblank") }),
      email: email(t("modaluseredit.errorinvalidemail")),
      first_name: z.string(),
      last_name: z.string(),
      password: z.string(),
      passwordConfirm: z.string(),
    }),
    t("settings.password.errormustmatch")
  );
}
