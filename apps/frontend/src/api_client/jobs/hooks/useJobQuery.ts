import { useQuery } from "@tanstack/react-query";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";
import { JobDetail } from "../types";
import { JobsQueryKeys } from "./useJobsQuery";

export const useJobQuery = (id: number) =>
  useQuery({
    queryKey: [...JobsQueryKeys, "detail", id],
    queryFn: async () => {
      const response = await fetchClient.get(`/jobs/${id}/`);
      return parseWithNotification(JobDetail, response, "Failed to parse job response");
    },
    // Follow a running job like the list does. Only once data is there, so a
    // missing job (404) is not polled every two seconds.
    refetchInterval: query => (query.state.data && !query.state.data.finished ? 2000 : false),
  });
