import { endpoints } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { statsKeys } from "../keys";

export const useLocationTimelineQuery = () =>
  useQuery({
    queryKey: statsKeys.locationTimeline(),
    queryFn: () => endpoints.fetchLocationTimeline(apiClient),
  });
