import { endpoints, jobKeys, pollWhile, settingsKeys } from "@librephotos/api-client";
import type { JobDetail, SiteModelDownload } from "@librephotos/api-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { apiClient } from "../../api";

function downloadStatus(job: JobDetail): string {
  if (job.cancelled) return "cancelled";
  if (job.failed) return "failed";
  return job.finished ? "finished" : "running";
}

/**
 * The newest model download as the Features card shows it, followed while it runs (#2217).
 *
 * The site settings are not polled for this: the settings form re-reads its fields on every fetch,
 * which would undo what the admin is typing. The job is polled instead, and once it ends the
 * settings are fetched one more time, for the models now on disk.
 */
export function useFollowModelDownload(download: SiteModelDownload | null | undefined) {
  const queryClient = useQueryClient();
  const running = download?.status === "running";
  const id = download?.id ?? 0;
  const { data: job } = useQuery({
    queryKey: jobKeys.detail(id),
    queryFn: () => endpoints.fetchJob(apiClient, id),
    enabled: running,
    refetchInterval: pollWhile<JobDetail>(current => !current.finished, false),
  });
  const ended = running && job?.finished === true;

  useEffect(() => {
    if (ended) {
      void queryClient.invalidateQueries({ queryKey: settingsKeys.site() });
    }
  }, [ended, queryClient]);

  if (!download || !running || !job) {
    return download;
  }
  return {
    id: download.id,
    status: downloadStatus(job),
    progress_current: job.progress_current,
    progress_target: job.progress_target,
  };
}
