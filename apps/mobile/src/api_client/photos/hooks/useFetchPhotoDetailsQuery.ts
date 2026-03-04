import { useQuery } from '@tanstack/react-query'
import { fetchClient } from '../../api'
import type { Photo } from '../types'

export const PhotoDetailsQueryKeys = ['photoDetails'] as const

export const useFetchPhotoDetailsQuery = (
  hash: string,
  skip: boolean = false,
) =>
  useQuery({
    queryKey: [...PhotoDetailsQueryKeys, hash],
    queryFn: async () => {
      if (!hash) {
        return null
      }
      const response = await fetchClient.get(`/photos/${hash}/`)
      return response as Photo
    },
    enabled: !skip && !!hash,
  })
