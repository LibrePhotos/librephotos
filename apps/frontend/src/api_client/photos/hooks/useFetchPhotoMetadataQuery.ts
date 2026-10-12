/**
 * React Query hook for fetching photo metadata
 */

import type { UseQueryOptions } from "@tanstack/react-query";
import { skipToken, useQuery } from "@tanstack/react-query";
import { photoKeys } from "../keys";
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
    queryKey: photoKeys.metadata(photoId),
    queryFn: photoId ? () => fetchPhotoMetadata(photoId) : skipToken,
    enabled: !!photoId,
    staleTime: 30 * 1000, // 30 seconds - metadata changes rarely
    ...options,
  });
}
