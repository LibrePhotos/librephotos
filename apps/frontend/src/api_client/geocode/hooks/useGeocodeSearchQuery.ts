import { endpoints } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { geocodeKeys } from "../keys";

export const useGeocodeSearchQuery = (query: string, enabled: boolean = true) =>
  useQuery({
    queryKey: geocodeKeys.search(query),
    queryFn: () => endpoints.searchGeocode(apiClient, query),
    enabled: enabled && query.trim().length > 2,
    staleTime: 5 * 60 * 1000, // 5 minutes - locations don't change often
  });
