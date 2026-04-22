import { useQuery } from '@tanstack/react-query'
import { parseWithNotification } from '../../../util/zodUtils'
import { fetchClient } from '../../api'
import {
  GeocodeSearchResponseSchema,
  type GeocodeSearchResponse,
} from '../types'

export const GeocodeSearchQueryKeys = ['geocodeSearch'] as const

export const useGeocodeSearchQuery = (query: string, enabled: boolean = true) =>
  useQuery({
    queryKey: [...GeocodeSearchQueryKeys, query],
    queryFn: async (): Promise<GeocodeSearchResponse> => {
      const response = await fetchClient.get<GeocodeSearchResponse>(
        `/geocode/search?q=${encodeURIComponent(query)}`,
      )
      return parseWithNotification(
        GeocodeSearchResponseSchema,
        response,
        'Failed to parse geocode search response',
      )
    },
    enabled: enabled && query.trim().length > 2,
    staleTime: 5 * 60 * 1000, // 5 minutes - locations don't change often
  })
