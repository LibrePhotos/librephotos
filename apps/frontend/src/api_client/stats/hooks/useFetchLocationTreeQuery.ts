import { endpoints, statsKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

export const useFetchLocationTreeQuery = () =>
  useQuery({
    queryKey: statsKeys.locationTree(),
    queryFn: () => endpoints.fetchLocationSunburst(apiClient),
  });
