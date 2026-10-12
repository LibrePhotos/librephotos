import { endpoints } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { statsKeys } from "../keys";

export const useFetchWordCloudQuery = () =>
  useQuery({
    queryKey: statsKeys.wordCloud(),
    queryFn: () => endpoints.fetchWordCloud(apiClient),
  });
