import { endpoints } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { statsKeys } from "../keys";

export const useFetchLocationTreeQuery = () =>
  useQuery({
    queryKey: statsKeys.locationTree(),
    queryFn: () => endpoints.fetchLocationSunburst(apiClient),
  });
