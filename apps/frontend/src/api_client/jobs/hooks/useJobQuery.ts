import { pollWhile } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";
import { jobKeys } from "../keys";
import { JobDetail } from "../types";

export const useJobQuery = (id: number) =>
  useQuery({
    queryKey: jobKeys.detail(id),
    queryFn: async () => {
      const response = await fetchClient.get(`/jobs/${id}/`);
      return parseWithNotification(JobDetail, response, "Failed to parse job response");
    },
    // Follow a running job like the list does. No polling once it has finished, and none before the
    // first answer, so a missing job (404) is not polled.
    refetchInterval: pollWhile<JobDetail>(job => !job.finished, false),
  });
