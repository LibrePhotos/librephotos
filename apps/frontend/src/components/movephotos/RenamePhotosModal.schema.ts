import type { ParseKeys, TFunction } from "i18next";
import { z } from "zod";
import { MAX_PATTERN_LENGTH, namePatternProblem, type PatternProblem } from "./namePatterns";

export type RenamePhotosValues = { pattern: string };

const PROBLEM_KEYS: Readonly<Record<Exclude<PatternProblem, null>, ParseKeys>> = {
  empty: "renamephotos.enterpattern",
  toolong: "renamephotos.toolong",
  unknowntoken: "renamephotos.unknowntoken",
  unsafe: "renamephotos.badpattern",
};

/** The name pattern of "Rename files…" (#2773): one the server takes (`api/photos/naming.py`). */
export function makeRenamePhotosSchema(t: TFunction) {
  return z.object({
    pattern: z.string().superRefine((pattern, context) => {
      const problem = namePatternProblem(pattern);
      if (problem !== null) {
        context.addIssue({ code: "custom", message: t(PROBLEM_KEYS[problem], { count: MAX_PATTERN_LENGTH }) });
      }
    }),
  });
}
