import { endpoints, statsKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

export const useFetchPhotoMonthCountQuery = () =>
  useQuery({
    queryKey: statsKeys.photoMonthCounts(),
    queryFn: () => endpoints.fetchPhotoMonthCounts(apiClient),
  });
