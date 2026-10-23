import type { TFunction } from "i18next";
import { z } from "zod";

/** The server's limit (`MAX_COMMENT_LENGTH` in api/albums/comments.py). */
export const MAX_COMMENT_LENGTH = 1000;

/** A comment on a photo in a shared album (#262): plain text, not blank, within the limit. */
export function makeCommentSchema(t: TFunction) {
  return z.object({
    text: z
      .string()
      .trim()
      .min(1, t("collab.commentEmpty"))
      .max(MAX_COMMENT_LENGTH, t("collab.commentTooLong", { max: MAX_COMMENT_LENGTH })),
  });
}
