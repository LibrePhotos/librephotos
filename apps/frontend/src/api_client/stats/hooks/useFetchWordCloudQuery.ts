import { endpoints, statsKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

export const useFetchWordCloudQuery = () =>
  useQuery({
    queryKey: statsKeys.wordCloud(),
    queryFn: () => endpoints.fetchWordCloud(apiClient),
  });
