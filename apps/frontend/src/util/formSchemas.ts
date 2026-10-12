/** Shared pieces of the form schemas; each takes the translated message the field shows. */
import { z } from "zod";

/** An e-mail address, by zod's maintained check rather than a hand-written pattern (#695). */
export function email(message: string) {
  return z.email({ error: message });
}

/** An e-mail address or nothing, for a form where the address is optional. */
export function optionalEmail(message: string) {
  return z.union([z.literal(""), email(message)]);
}
