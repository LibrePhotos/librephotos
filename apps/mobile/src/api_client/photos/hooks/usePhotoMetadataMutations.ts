/**
 * React Query mutation hooks for photo metadata operations
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchClient } from '../../api'
import type { PhotoMetadata } from '../types'

type MetadataUpdateFields = {
  title?: string
  caption?: string
  keywords?: string[]
  rating?: number
  copyright?: string
  creator?: string
}

/**
 * Update metadata for a photo (changes are tracked in history)
 */
export function useUpdatePhotoMetadataMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      photoId,
      updates,
    }: {
      photoId: string
      updates: MetadataUpdateFields
    }) => {
      const response = await fetchClient.patch(
        `/photos/${photoId}/metadata`,
        updates,
      )
      return response as PhotoMetadata
    },
    onSuccess: (data, { photoId }) => {
      // Invalidate metadata queries
      queryClient.invalidateQueries({ queryKey: ['photoMetadata', photoId] })
      queryClient.invalidateQueries({ queryKey: ['metadataHistory', photoId] })
      // Also invalidate photo details since it includes metadata summary
      queryClient.invalidateQueries({ queryKey: ['photoDetails'] })
    },
  })
}

/**
 * Revert a specific metadata edit
 */
export function useRevertMetadataEditMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      photoId,
      editId,
    }: {
      photoId: string
      editId: number
    }) => {
      const response = await fetchClient.post(
        `/photos/${photoId}/metadata/revert/${editId}`,
      )
      return response as PhotoMetadata
    },
    onSuccess: (data, { photoId }) => {
      queryClient.invalidateQueries({ queryKey: ['photoMetadata', photoId] })
      queryClient.invalidateQueries({ queryKey: ['metadataHistory', photoId] })
      queryClient.invalidateQueries({ queryKey: ['photoDetails'] })
    },
  })
}

/**
 * Revert all edits and restore original embedded metadata
 */
export function useRevertAllMetadataEditsMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (photoId: string) => {
      const response = await fetchClient.post(
        `/photos/${photoId}/metadata/revert-all`,
      )
      return response as PhotoMetadata
    },
    onSuccess: (data, photoId) => {
      queryClient.invalidateQueries({ queryKey: ['photoMetadata', photoId] })
      queryClient.invalidateQueries({ queryKey: ['metadataHistory', photoId] })
      queryClient.invalidateQueries({ queryKey: ['photoDetails'] })
    },
  })
}

/**
 * Bulk update metadata for multiple photos
 */
export function useBulkUpdateMetadataMutation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      photoIds,
      updates,
    }: {
      photoIds: string[]
      updates: MetadataUpdateFields
    }) => {
      const response = await fetchClient.patch('/photos/metadata/bulk', {
        photo_ids: photoIds,
        updates,
      })
      return response as { updated_count: number; message: string }
    },
    onSuccess: (data, { photoIds }) => {
      // Invalidate all affected photo metadata queries
      photoIds.forEach(photoId => {
        queryClient.invalidateQueries({ queryKey: ['photoMetadata', photoId] })
        queryClient.invalidateQueries({
          queryKey: ['metadataHistory', photoId],
        })
      })
      queryClient.invalidateQueries({ queryKey: ['photoDetails'] })
    },
  })
}
