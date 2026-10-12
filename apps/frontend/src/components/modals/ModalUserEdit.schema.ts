import type { TFunction } from "i18next";
import { z } from "zod";
import { optionalEmail, uniqueName, withNewPassword } from "../../util/formSchemas";
import { passwordMessages } from "../settings/PasswordEntry.schema";

type UserEditContext = Readonly<{
  /** The names of the other users; the edited user keeps their own. */
  otherUsernames: readonly string[];
  /** "Create user": a password is required, and there is no lock in front of it. */
  createNew: boolean;
  /** The first-run setup requires a scan directory. */
  firstTimeSetup: boolean;
  /** What the directory pickers report about the typed paths. */
  isPathValid: boolean;
  isUploadPathValid: boolean;
}>;

/** The admin's "Create user" / "Edit user" dialog. */
export function makeUserEditSchema(t: TFunction, context: UserEditContext) {
  const { otherUsernames, createNew, firstTimeSetup, isPathValid, isUploadPathValid } = context;
  const missingPath = t("modalscandirectoryedit.pathdoesnotexist");
  const fields = z.object({
    username: z
      .string()
      .min(1, { error: t("modaluseredit.errorusernamecannotbeblank") })
      .pipe(uniqueName(otherUsernames, t("modaluseredit.errorusernameexists"))),
    email: optionalEmail(t("modaluseredit.errorinvalidemail")),
    first_name: z.string(),
    last_name: z.string(),
    password: z.string(),
    passwordConfirm: z.string(),
    changePassword: z.boolean(),
    scan_directory: z
      .string()
      .refine(path => !firstTimeSetup || path !== "", { error: t("modalscandirectoryedit.mustspecifypath") })
      .refine(path => path === "" || isPathValid, { error: missingPath }),
    upload_directory: z.string().refine(path => path === "" || isUploadPathValid, { error: missingPath }),
  });
  return withNewPassword(fields, passwordMessages(t), { required: createNew });
}
