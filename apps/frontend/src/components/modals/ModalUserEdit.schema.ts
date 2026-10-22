import type { TFunction } from "i18next";
import { z } from "zod";
import { optionalEmail, uniqueName, withNewPassword } from "../../util/formSchemas";
import { passwordMessages } from "../settings/PasswordEntry.schema";
import type { PhotosOutsideChoice } from "./ScanDirectoryChangeNotice";

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

/** The values of the admin's user dialog. */
export type UserEditValues = {
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  password: string;
  passwordConfirm: string;
  changePassword: boolean;
  scan_directory: string;
  upload_directory: string;
  photos_outside: PhotosOutsideChoice;
};

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
    // What happens to the photos a changed scan directory leaves outside (#2036); not sent with the user.
    photos_outside: z.enum(["keep", "trash"]),
  });
  return withNewPassword(fields, passwordMessages(t), { required: createNew });
}
