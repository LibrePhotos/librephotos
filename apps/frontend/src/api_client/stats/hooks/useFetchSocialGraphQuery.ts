import { endpoints, statsKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

export const useFetchSocialGraphQuery = () =>
  useQuery({
    queryKey: statsKeys.socialGraph(),
    queryFn: () => endpoints.fetchSocialGraph(apiClient),
  });
