import type { TFunction } from "i18next";
import { z } from "zod";
import { withNewPassword } from "../../util/formSchemas";
import { passwordMessages } from "./PasswordEntry.schema";

const profileFields = z.object({
  first_name: z.string(),
  last_name: z.string(),
  // The server checks the address, as it did before this was a form.
  email: z.string(),
  public_sharing: z.boolean(),
  password: z.string(),
  passwordConfirm: z.string(),
  changePassword: z.boolean(),
});

export type ProfileValues = z.infer<typeof profileFields>;

/** The Profile page: the account fields, public sharing and a new password. */
export function makeProfileSchema(t: TFunction) {
  return withNewPassword(profileFields, passwordMessages(t));
}
