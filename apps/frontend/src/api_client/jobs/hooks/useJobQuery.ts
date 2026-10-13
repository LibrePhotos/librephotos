import { endpoints, jobKeys, pollWhile } from "@librephotos/api-client";
import type { JobDetail } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

export const useJobQuery = (id: number) =>
  useQuery({
    queryKey: jobKeys.detail(id),
    queryFn: () => endpoints.fetchJob(apiClient, id),
    // Follow a running job like the list does. No polling once it has finished, and none before the
    // first answer, so a missing job (404) is not polled.
    refetchInterval: pollWhile<JobDetail>(job => !job.finished, false),
  });
