import { endpoints } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { statsKeys } from "../keys";

export const useFetchPhotoMonthCountQuery = () =>
  useQuery({
    queryKey: statsKeys.photoMonthCounts(),
    queryFn: () => endpoints.fetchPhotoMonthCounts(apiClient),
  });
