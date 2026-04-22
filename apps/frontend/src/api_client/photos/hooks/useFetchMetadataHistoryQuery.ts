/**
 * React Query hook for fetching metadata edit history
 */

import { useQuery, UseQueryOptions } from "@tanstack/react-query";
import { fetchClient } from "../../api";
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
    queryKey: ["metadataHistory", photoId, page, pageSize],
    queryFn: async () => {
      const response = await fetchClient.get(`/photos/${photoId}/metadata/history?page=${page}&page_size=${pageSize}`);
      return response as MetadataHistoryResponse;
    },
    enabled: !!photoId,
    staleTime: 10 * 1000, // 10 seconds
    ...options,
  });
}
