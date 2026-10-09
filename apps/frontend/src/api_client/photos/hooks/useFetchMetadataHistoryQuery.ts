/**
 * React Query hook for fetching metadata edit history
 */

import { useQuery, UseQueryOptions } from "@tanstack/react-query";
import { fetchMetadataHistory } from "../metadata";
import type { MetadataHistoryResponse } from "../types";

type FetchMetadataHistoryOptions = UseQueryOptions<MetadataHistoryResponse, Error>;

/**
 * Fetch metadata edit history for a photo
 */
export function useFetchMetadataHistoryQuery(
  photoId: string | undefined,
  page = 1,
  pageSize = 20,
  options?: Omit<FetchMetadataHistoryOptions, "queryKey" | "queryFn">
) {
  return useQuery({
    // Goes through the api_client function so the response is validated against
    // the MetadataHistoryResponse schema instead of being blind-cast.
    queryKey: ["metadataHistory", photoId, page, pageSize],
    queryFn: () => {
      // Only runs while enabled, i.e. with a photo (unless options turn it on without one).
      if (!photoId) throw new Error("No photo to load the metadata history of");
      return fetchMetadataHistory(photoId, page, pageSize);
    },
    enabled: !!photoId,
    staleTime: 10 * 1000, // 10 seconds
    ...options,
  });
}
