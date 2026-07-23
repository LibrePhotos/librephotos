/**
 * React Query hook for fetching photo metadata
 */

import { useQuery, UseQueryOptions } from "@tanstack/react-query";
import { fetchPhotoMetadata } from "../metadata";
import type { PhotoMetadata } from "../types";

type FetchPhotoMetadataOptions = UseQueryOptions<PhotoMetadata, Error>;

/**
 * Fetch full structured metadata for a photo
 */
export function useFetchPhotoMetadataQuery(
  photoId: string | undefined,
  options?: Omit<FetchPhotoMetadataOptions, "queryKey" | "queryFn">
) {
  return useQuery({
    // Goes through the api_client function so the response is validated against
    // the PhotoMetadata schema instead of being blind-cast.
    queryKey: ["photoMetadata", photoId],
    queryFn: () => fetchPhotoMetadata(photoId!),
    enabled: !!photoId,
    staleTime: 30 * 1000, // 30 seconds - metadata changes rarely
    ...options,
  });
}
