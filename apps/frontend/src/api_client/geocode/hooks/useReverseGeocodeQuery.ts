import { endpoints, geocodeKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

/** The place name at `position` ([lat, lon]), for the location picker before it saves. */
export const useReverseGeocodeQuery = (position: readonly [number, number] | null) => {
  const [lat, lon] = position ?? [0, 0];
  return useQuery({
    queryKey: geocodeKeys.reverse(lat, lon),
    queryFn: () => endpoints.reverseGeocode(apiClient, lat, lon),
    enabled: position !== null,
    // A spot keeps its name; a failed lookup shows "unavailable" at once instead of retrying.
    staleTime: Infinity,
    retry: false,
  });
};
