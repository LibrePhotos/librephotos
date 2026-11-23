import { endpoints, statsKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

export const useFetchPhotoDayCountQuery = () =>
  useQuery({
    queryKey: statsKeys.photoDayCounts(),
    queryFn: () => endpoints.fetchPhotoDayCounts(apiClient),
  });
