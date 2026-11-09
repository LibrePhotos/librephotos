import type { TFunction } from "i18next";
import { DateTime, Duration } from "luxon";
import { parseInstant } from "../../util/dateUtils";

/**
 * Human duration of a job, up to now while it is still running. Sub-second
 * jobs keep their milliseconds; longer ones are rounded to whole seconds so
 * they read "2 min, 58 sec" instead of listing milliseconds as well.
 */
export function formatJobDuration(startedAt: string, finishedAt?: string | null): string {
  const end = finishedAt ? parseInstant(finishedAt) : DateTime.now();
  const ms = Math.max(0, end.diff(parseInstant(startedAt)).as("milliseconds"));
  const duration =
    ms < 1000
      ? Duration.fromObject({ milliseconds: Math.round(ms) })
      : Duration.fromObject({ seconds: Math.round(ms / 1000) }).rescale();
  return duration.toHuman({ unitDisplay: "short" });
}

type JobTimes = Readonly<{ finished: boolean; finished_at: string | null; started_at: string | null }>;

/**
 * How long a job took ("482 ms"), or that it is still running or waiting. A job cancelled
 * before it started has no duration (null).
 */
export function jobDurationLabel(job: JobTimes, t: TFunction): string | null {
  if (job.finished) {
    return job.started_at && job.finished_at ? formatJobDuration(job.started_at, job.finished_at) : null;
  }
  return job.started_at ? t("joblist.running") : t("joblist.waiting");
}
