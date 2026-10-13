/**
 * React Query hook for fetching photo metadata
 */

import { endpoints, photoKeys } from "@librephotos/api-client";
import type { PhotoMetadata } from "@librephotos/api-client";
import type { UseQueryOptions } from "@tanstack/react-query";
import { skipToken, useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

type FetchPhotoMetadataOptions = UseQueryOptions<PhotoMetadata, Error>;

/**
 * Fetch full structured metadata for a photo
 */
export function useFetchPhotoMetadataQuery(
  photoId: string | undefined,
  options?: Omit<FetchPhotoMetadataOptions, "queryKey" | "queryFn">
) {
  return useQuery({
    queryKey: photoKeys.metadata(photoId),
    queryFn: photoId ? () => endpoints.fetchPhotoMetadata(apiClient, photoId) : skipToken,
    enabled: !!photoId,
    staleTime: 30 * 1000, // 30 seconds - metadata changes rarely
    ...options,
  });
}
