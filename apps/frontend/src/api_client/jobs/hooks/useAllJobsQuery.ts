import { endpoints, jobKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

/** Every job of the list, all its pages: what a bulk action works from, not what the list shows. */
export const useAllJobsQuery = (mine: boolean) =>
  useQuery({
    queryKey: jobKeys.every(mine),
    queryFn: () => endpoints.fetchAllJobs(apiClient, { mine }),
  });
