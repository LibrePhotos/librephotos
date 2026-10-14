import { endpoints, photoKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

/** A time window as ISO date-times. */
export type TimeWindow = Readonly<{ from: string; to: string }>;

const NO_WINDOW: TimeWindow = { from: "", to: "" };

/** The user's geotagged photos taken in `span`, nearest to its middle first (at most 20). */
export const useLocatedNearbyQuery = (span: TimeWindow | null) => {
  const { from, to } = span ?? NO_WINDOW;
  return useQuery({
    queryKey: photoKeys.locatedNearby(from, to),
    queryFn: () => endpoints.fetchLocatedNearbyInTime(apiClient, from, to),
    enabled: span !== null,
  });
};
