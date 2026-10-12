import type { TFunction } from "i18next";
import { z } from "zod";
import { email, withMatchingPasswords } from "../util/formSchemas";

/** The reset request on /password-reset. */
export function makePasswordResetRequestSchema(t: TFunction) {
  return z.object({ email: email(t("passwordreset.erroremail")) });
}

/** The new password, typed twice, on the link from the reset e-mail. */
export function makeNewPasswordSchema(t: TFunction) {
  return withMatchingPasswords(
    z.object({ password: z.string(), passwordConfirm: z.string() }),
    t("passwordreset.errormustmatch")
  );
}
