import { ApiError, endpoints, jobKeys, POLL_ACTIVE_MS, POLL_IDLE_MS, type JobDetail } from "@librephotos/api-client";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { apiClient } from "../../api";
import { findOwnJob, type JobLookup } from "../findOwnJob";

/** Where a followed job stands. `lost`: the job is no longer on the user's list (removed). */
export type JobFollow =
  | { state: "idle" }
  | { state: "finding" }
  | { state: "running"; job: JobDetail }
  | { state: "ended"; job: JobDetail }
  | { state: "lost" };

const isGone = (error: unknown) => error instanceof ApiError && error.status === 404;

/** The follow's state from the lookup by `job_id` and the job's own answer. */
export function followState(
  jobId: string | null,
  lookup: JobLookup | undefined,
  job: JobDetail | undefined,
  jobError: unknown
): JobFollow {
  if (jobId === null) return { state: "idle" };
  const known = job?.job_id === jobId ? job : undefined;
  if (known?.finished) return { state: "ended", job: known };
  if (lookup?.state === "gone" || isGone(jobError)) return { state: "lost" };
  return known ? { state: "running", job: known } : { state: "finding" };
}

// Until the job is found (or the request fails), ask again at the idle cadence; once found, never.
const lookupCadence = (query: { state: { data: JobLookup | undefined } }): number | false =>
  query.state.data === undefined || query.state.data.state === "notYet" ? POLL_IDLE_MS : false;

/** Every two seconds while the job runs; no more once it has ended or is gone. */
function jobCadence(query: { state: { data: JobDetail | undefined; error: unknown } }): number | false {
  const job = query.state.data;
  if (job?.finished || isGone(query.state.error)) return false;
  return job ? POLL_ACTIVE_MS : POLL_IDLE_MS;
}

// A job's end (or loss) is reported once per page load, however many components follow it.
const settled = new Set<string>();

function settleOnce(jobId: string): boolean {
  if (settled.has(jobId)) return false;
  settled.add(jobId);
  return true;
}

/**
 * Follows the user's job `jobId` (the `job_id` its trigger answered with; null: none). The job is
 * looked up once on the newest page of the user's list, then fetched by its own id, so it is not
 * lost when newer jobs push it off that page. Calls `onEnded` once the job has finished and `onLost`
 * when it was removed meanwhile, each at most once per job.
 */
export function useFollowJob(jobId: string | null, onEnded: (job: JobDetail) => void, onLost: () => void): JobFollow {
  const lookup = useQuery({
    queryKey: jobKeys.lookup(jobId ?? ""),
    queryFn: jobId === null ? skipToken : () => findOwnJob(jobId),
    staleTime: Infinity,
    refetchInterval: lookupCadence,
  });
  const id = lookup.data?.state === "found" ? lookup.data.id : null;
  const detail = useQuery({
    queryKey: jobKeys.detail(id ?? 0),
    queryFn: id === null ? skipToken : () => endpoints.fetchJob(apiClient, id),
    refetchInterval: jobCadence,
    retry: (failures, error) => !isGone(error) && failures < 1,
  });
  const follow = followState(jobId, lookup.data, detail.data, detail.error);
  const ended = follow.state === "ended" ? follow.job : undefined;
  const lost = follow.state === "lost";

  useEffect(() => {
    if (ended && settleOnce(ended.job_id)) onEnded(ended);
  }, [ended, onEnded]);
  useEffect(() => {
    if (lost && jobId !== null && settleOnce(jobId)) onLost();
  }, [lost, jobId, onLost]);

  return follow;
}
