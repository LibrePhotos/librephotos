import { endpoints, statsKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

export const useLocationTimelineQuery = () =>
  useQuery({
    queryKey: statsKeys.locationTimeline(),
    queryFn: () => endpoints.fetchLocationTimeline(apiClient),
  });
