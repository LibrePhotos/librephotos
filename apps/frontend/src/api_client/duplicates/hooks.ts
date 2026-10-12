import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../api";
import { startJob } from "../jobs/startJob";
import { duplicateKeys } from "./keys";
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
} from "./types";

// Fetch duplicate groups list with pagination
const useFetchDuplicatesQuery = (
  duplicateType?: DuplicateType,
  status?: ReviewStatus,
  page: number = 1,
  pageSize: number = 20
) => {
  const params = new URLSearchParams();
  if (duplicateType) params.append("duplicate_type", duplicateType);
  if (status) params.append("status", status);
  params.append("page", String(page));
  params.append("page_size", String(pageSize));

  return useQuery({
    queryKey: duplicateKeys.list(duplicateType, status, page, pageSize),
    queryFn: () => apiClient.get<DuplicateListResponse>(`/duplicates?${params.toString()}`),
  });
};

// Fetch single duplicate group details
const useFetchDuplicateQuery = (duplicateId: string) =>
  useQuery({
    queryKey: duplicateKeys.detail(duplicateId),
    queryFn: () => apiClient.get<DuplicateDetail>(`/duplicates/${duplicateId}`),
    enabled: !!duplicateId,
  });

// Fetch duplicate stats
const useFetchDuplicateStatsQuery = (options?: { staleTime?: number }) =>
  useQuery({
    queryKey: duplicateKeys.stats(),
    queryFn: () => apiClient.get<DuplicateStats>("/duplicates/stats"),
    staleTime: options?.staleTime,
  });

// Detect duplicates mutation
export const useDetectDuplicatesMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (options: DetectDuplicatesRequest = {}) =>
      startJob(() => apiClient.post<DetectDuplicatesResponse>("/duplicates/detect", options)),
    onSuccess: () => {
      // Invalidate stats to show updated detection status
      queryClient.invalidateQueries({ queryKey: duplicateKeys.stats() });
    },
  });
};

// Resolve duplicate group mutation
export const useResolveDuplicateMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      keep_photo_hash,
      trash_others,
    }: {
      id: string;
      keep_photo_hash: string;
      trash_others: boolean;
    }) => {
      const data: ResolveDuplicateRequest = { keep_photo_hash, trash_others };
      return apiClient.post<ResolveDuplicateResponse>(`/duplicates/${id}/resolve`, data);
    },
    onSuccess: (_, { id }) => {
      // Invalidate the specific duplicate and the list
      queryClient.invalidateQueries({ queryKey: duplicateKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: duplicateKeys.all });
      queryClient.invalidateQueries({ queryKey: duplicateKeys.stats() });
    },
  });
};

// Dismiss duplicate group mutation
export const useDismissDuplicateMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (duplicateId: number | string) => {
      const id = String(duplicateId);
      return apiClient.post<{ status: string }>(`/duplicates/${id}/dismiss`, {});
    },
    onSuccess: (_, duplicateId) => {
      const id = String(duplicateId);
      queryClient.invalidateQueries({ queryKey: duplicateKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: duplicateKeys.all });
      queryClient.invalidateQueries({ queryKey: duplicateKeys.stats() });
    },
  });
};

// Revert duplicate resolution mutation
export const useRevertDuplicateMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (duplicateId: number | string) => {
      const id = String(duplicateId);
      return apiClient.post<{ status: string; restored_count: number }>(`/duplicates/${id}/revert`, {});
    },
    onSuccess: (_, duplicateId) => {
      const id = String(duplicateId);
      queryClient.invalidateQueries({ queryKey: duplicateKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: duplicateKeys.all });
      queryClient.invalidateQueries({ queryKey: duplicateKeys.stats() });
    },
  });
};

// Delete duplicate group mutation
export const useDeleteDuplicateMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (duplicateId: number | string) => {
      const id = String(duplicateId);
      return apiClient.delete<{ status: string; unlinked_count: number }>(`/duplicates/${id}/delete`);
    },
    onSuccess: (_, duplicateId) => {
      const id = String(duplicateId);
      queryClient.invalidateQueries({ queryKey: duplicateKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: duplicateKeys.all });
      queryClient.invalidateQueries({ queryKey: duplicateKeys.stats() });
    },
  });
};

// Alias exports for compatibility with component usage
export const useDuplicateQuery = (duplicateId: string) => useFetchDuplicateQuery(duplicateId);

export const useDuplicatesQuery = (params: {
  duplicate_type?: DuplicateType;
  review_status?: ReviewStatus;
  page?: number;
  page_size?: number;
}) => useFetchDuplicatesQuery(params.duplicate_type, params.review_status, params.page, params.page_size);

export const useDuplicateStatsQuery = useFetchDuplicateStatsQuery;
