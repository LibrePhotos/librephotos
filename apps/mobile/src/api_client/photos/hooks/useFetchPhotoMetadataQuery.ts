/**
 * React Query hook for fetching photo metadata
 */

import { useQuery, UseQueryOptions } from '@tanstack/react-query'
import { fetchClient } from '../../api'
import type { PhotoMetadata } from '../types'

type FetchPhotoMetadataOptions = UseQueryOptions<PhotoMetadata, Error>

/**
 * Fetch full structured metadata for a photo
 */
export function useFetchPhotoMetadataQuery(
  photoId: string | undefined,
  options?: Omit<FetchPhotoMetadataOptions, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey: ['photoMetadata', photoId],
    queryFn: async () => {
      const response = await fetchClient.get(`/photos/${photoId}/metadata`)
      return response as PhotoMetadata
    },
    enabled: !!photoId,
    staleTime: 30 * 1000, // 30 seconds - metadata changes rarely
    ...options,
  })
}
