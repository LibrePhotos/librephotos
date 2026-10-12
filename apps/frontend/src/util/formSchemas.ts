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

/**
 * A name that is not one of `existingNames`, compared trimmed and case-insensitively, the way a
 * person, album, tag or user name reads to the user.
 */
export function uniqueName(existingNames: Iterable<string>, message: string) {
  const taken = new Set(Array.from(existingNames, nameKey));
  return z.string().refine(name => !taken.has(nameKey(name)), { error: message });
}

type PasswordPair = { password: string; passwordConfirm: string };

/** `schema` with `passwordConfirm` required to repeat `password`; the error shows on `passwordConfirm`. */
export function withMatchingPasswords<Values extends PasswordPair>(schema: z.ZodType<Values>, message: string) {
  return schema.refine(values => values.password === values.passwordConfirm, {
    error: message,
    path: ["passwordConfirm"],
  });
}
