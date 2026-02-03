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
  });

