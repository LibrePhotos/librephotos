/**
 * Shared pieces of the form schemas (AGENTS.md, "Forms"). A form validates with
 * `useForm({ validate: schemaResolver(schema, { sync: true }) })` and a zod schema built by a
 * `make<Form>Schema(t)` factory next to it, so every message below is the translated text the
 * field shows.
 */
import { z } from "zod";

/** An e-mail address, by zod's maintained check rather than a hand-written pattern (#695). */
export function email(message: string) {
  return z.email({ error: message });
}

/** An e-mail address or nothing, for a form where the address is optional. */
export function optionalEmail(message: string) {
  return z.union([z.literal(""), email(message)]);
}

const nameKey = (name: string) => name.trim().toLowerCase();

/** A message, or one built from the trimmed name it is about ("Album Trip already exists."). */
type NameMessage = string | ((name: string) => string);

/**
 * A name that is not one of `existingNames`, compared trimmed and case-insensitively, the way a
 * person, album, tag or user name reads to the user.
 */
export function uniqueName(existingNames: Iterable<string>, message: NameMessage) {
  const taken = new Set(Array.from(existingNames, nameKey));
  return z.string().refine(name => !taken.has(nameKey(name)), {
    error: issue =>
      typeof message === "string" ? message : message(typeof issue.input === "string" ? issue.input.trim() : ""),
  });
}

/**
 * A new name for a person, album or tag: trimmed, not blank, and not one of `existingNames`. The
 * schema's output is the trimmed name; a form hands it on through `transformValues`.
 */
export function newName(existingNames: Iterable<string>, messages: { blank: string; taken: NameMessage }) {
  return z.string().trim().min(1, { error: messages.blank }).pipe(uniqueName(existingNames, messages.taken));
}

/** The password fields of `components/settings/PasswordEntry`; `changePassword` is its lock (true: unlocked). */
export type NewPasswordFields = { password: string; passwordConfirm: string; changePassword: boolean };

/**
 * `schema` with the password fields of `components/settings/PasswordEntry`: while a password is
 * set (`required`, the "Create user" dialog) or being changed (`changePassword`, the fields are
 * unlocked), it must not be blank and must be typed twice alike. Locked fields are not checked.
 */
export function withNewPassword<Values extends NewPasswordFields>(
  schema: z.ZodType<Values>,
  messages: { blank: string; retype: string; mismatch: string },
  { required = false }: { required?: boolean } = {}
) {
  const checked = (values: Values) => required || values.changePassword;
  return schema
    .refine(values => !checked(values) || values.password !== "" || values.passwordConfirm !== "", {
      error: messages.blank,
      path: ["password"],
    })
    .refine(values => !checked(values) || values.password === "" || values.passwordConfirm !== "", {
      error: messages.retype,
      path: ["passwordConfirm"],
    })
    .refine(values => !checked(values) || values.passwordConfirm === "" || values.password === values.passwordConfirm, {
      error: messages.mismatch,
      path: ["passwordConfirm"],
    });
}

type PasswordPair = { password: string; passwordConfirm: string };

/** `schema` with `passwordConfirm` required to repeat `password`; the error shows on `passwordConfirm`. */
export function withMatchingPasswords<Values extends PasswordPair>(schema: z.ZodType<Values>, message: string) {
  return schema.refine(values => values.password === values.passwordConfirm, {
    error: message,
    path: ["passwordConfirm"],
  });
}
