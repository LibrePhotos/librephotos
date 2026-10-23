import { z } from "zod";

/** LongRunningJob.JOB_CHECK_FILE_CONTENTS in the backend. */
export const CHECK_FILE_CONTENTS_JOB_TYPE = 32;

const counts = {
  checked: z.number(),
  unchanged: z.number(),
  missing: z.number(),
  unreadable: z.number(),
  new_picture: z.number(),
  same_picture: z.number(),
  similar_picture: z.number(),
  uncomparable: z.number(),
};

/** What a file became: the backend's verdicts (api/directory_watcher/file_handlers.py). */
const Verdict = z.enum(["new_picture", "same_picture", "similar_picture", "uncomparable"]);
export type Verdict = z.infer<typeof Verdict>;

/**
 * The `result` of a Check file contents job (#2040, `api/directory_watcher/content_check.py`
 * `job_result`): counts overall and per user, and the changed files (at most 100 each).
 */
const CheckFileContentsResult = z.looseObject({
  ...counts,
  users: z.array(z.looseObject({ user_id: z.number(), username: z.string(), ...counts })),
  changed: z.array(
    z.looseObject({
      path: z.string(),
      verdict: Verdict,
      named_faces_removed: z.number(),
    })
  ),
  rescans: z.number(),
});
export type CheckFileContentsResult = z.infer<typeof CheckFileContentsResult>;

/** The job's result read as a Check file contents result, or null for anything else (a failed run). */
export function parseCheckFileContentsResult(result: unknown): CheckFileContentsResult | null {
  const parsed = CheckFileContentsResult.safeParse(result);
  return parsed.success ? parsed.data : null;
}
