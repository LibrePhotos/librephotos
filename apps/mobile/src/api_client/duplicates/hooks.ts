import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchClient } from '../api'
import type {
  DetectDuplicatesRequest,
  DetectDuplicatesResponse,
  DuplicateDetail,
  DuplicateListResponse,
  DuplicateStats,
  DuplicateType,
  ResolveDuplicateRequest,
  ResolveDuplicateResponse,
  ReviewStatus,
} from './types'

// Query keys
export const DuplicatesQueryKeys = {
  all: ['duplicates'] as const,
  list: (
    duplicateType?: DuplicateType,
    status?: ReviewStatus,
    page?: number,
    pageSize?: number,
  ) =>
    [
      ...DuplicatesQueryKeys.all,
      'list',
      duplicateType,
      status,
      page,
      pageSize,
    ] as const,
  detail: (id: string) => [...DuplicatesQueryKeys.all, 'detail', id] as const,
  stats: () => [...DuplicatesQueryKeys.all, 'stats'] as const,
}

// Fetch duplicate groups list with pagination
export const useFetchDuplicatesQuery = (
  duplicateType?: DuplicateType,
  status?: ReviewStatus,
  page: number = 1,
  pageSize: number = 20,
) => {
  const params = new URLSearchParams()
  if (duplicateType) {
    params.append('duplicate_type', duplicateType)
  }
  if (status) {
    params.append('status', status)
  }
  params.append('page', String(page))
  params.append('page_size', String(pageSize))

  return useQuery({
    queryKey: DuplicatesQueryKeys.list(duplicateType, status, page, pageSize),
    queryFn: () =>
      fetchClient.get<DuplicateListResponse>(
        `/duplicates?${params.toString()}`,
      ),
  })
}

// Fetch single duplicate group details
export const useFetchDuplicateQuery = (duplicateId: string) =>
  useQuery({
    queryKey: DuplicatesQueryKeys.detail(duplicateId),
    queryFn: () =>
      fetchClient.get<DuplicateDetail>(`/duplicates/${duplicateId}`),
    enabled: !!duplicateId,
  })

// Fetch duplicate stats
export const useFetchDuplicateStatsQuery = () =>
  useQuery({
    queryKey: DuplicatesQueryKeys.stats(),
    queryFn: () => fetchClient.get<DuplicateStats>('/duplicates/stats'),
  })

// Detect duplicates mutation
export const useDetectDuplicatesMutation = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (options: DetectDuplicatesRequest = {}) =>
      fetchClient.post<DetectDuplicatesResponse>('/duplicates/detect', options),
    onSuccess: () => {
      // Invalidate stats to show updated detection status
      queryClient.invalidateQueries({ queryKey: DuplicatesQueryKeys.stats() })
    },
  })
}

// Resolve duplicate group mutation
export const useResolveDuplicateMutation = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      keep_photo_hash,
      trash_others,
    }: {
      id: string
      keep_photo_hash: string
      trash_others: boolean
    }) => {
      const data: ResolveDuplicateRequest = { keep_photo_hash, trash_others }
      return fetchClient.post<ResolveDuplicateResponse>(
        `/duplicates/${id}/resolve`,
        data,
      )
    },
    onSuccess: (_, { id }) => {
      // Invalidate the specific duplicate and the list
      queryClient.invalidateQueries({
        queryKey: DuplicatesQueryKeys.detail(id),
      })
      queryClient.invalidateQueries({ queryKey: DuplicatesQueryKeys.all })
      queryClient.invalidateQueries({ queryKey: DuplicatesQueryKeys.stats() })
    },
  })
}

// Dismiss duplicate group mutation
export const useDismissDuplicateMutation = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (duplicateId: number | string) => {
      const id = String(duplicateId)
      return fetchClient.post<{ status: string }>(
        `/duplicates/${id}/dismiss`,
        {},
      )
    },
    onSuccess: (_, duplicateId) => {
      const id = String(duplicateId)
      queryClient.invalidateQueries({
        queryKey: DuplicatesQueryKeys.detail(id),
      })
      queryClient.invalidateQueries({ queryKey: DuplicatesQueryKeys.all })
      queryClient.invalidateQueries({ queryKey: DuplicatesQueryKeys.stats() })
    },
  })
}

// Revert duplicate resolution mutation
export const useRevertDuplicateMutation = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (duplicateId: number | string) => {
      const id = String(duplicateId)
      return fetchClient.post<{ status: string; restored_count: number }>(
        `/duplicates/${id}/revert`,
        {},
      )
    },
    onSuccess: (_, duplicateId) => {
      const id = String(duplicateId)
      queryClient.invalidateQueries({
        queryKey: DuplicatesQueryKeys.detail(id),
      })
      queryClient.invalidateQueries({ queryKey: DuplicatesQueryKeys.all })
      queryClient.invalidateQueries({ queryKey: DuplicatesQueryKeys.stats() })
    },
  })
}

// Delete duplicate group mutation
export const useDeleteDuplicateMutation = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (duplicateId: number | string) => {
      const id = String(duplicateId)
      return fetchClient.delete<{ status: string; unlinked_count: number }>(
        `/duplicates/${id}/delete`,
      )
    },
    onSuccess: (_, duplicateId) => {
      const id = String(duplicateId)
      queryClient.invalidateQueries({
        queryKey: DuplicatesQueryKeys.detail(id),
      })
      queryClient.invalidateQueries({ queryKey: DuplicatesQueryKeys.all })
      queryClient.invalidateQueries({ queryKey: DuplicatesQueryKeys.stats() })
    },
  })
}

// Alias exports for compatibility with component usage
export const useDuplicateQuery = (duplicateId: string) =>
  useFetchDuplicateQuery(duplicateId)

export const useDuplicatesQuery = (params: {
  duplicate_type?: DuplicateType
  review_status?: ReviewStatus
  page?: number
  page_size?: number
}) =>
  useFetchDuplicatesQuery(
    params.duplicate_type,
    params.review_status,
    params.page,
    params.page_size,
  )

export const useDuplicateStatsQuery = useFetchDuplicateStatsQuery
