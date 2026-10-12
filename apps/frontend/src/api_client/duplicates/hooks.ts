import { endpoints } from "@librephotos/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../api";
import { startJob } from "../jobs/startJob";
import { duplicateKeys } from "./keys";
import type { DetectDuplicatesRequest, DuplicateType, ReviewStatus } from "./types";

// Fetch duplicate groups list with pagination
const useFetchDuplicatesQuery = (
  duplicateType?: DuplicateType,
  status?: ReviewStatus,
  page: number = 1,
  pageSize: number = 20
) =>
  useQuery({
    queryKey: duplicateKeys.list(duplicateType, status, page, pageSize),
    queryFn: () => endpoints.fetchDuplicates(apiClient, { duplicateType, status, page, pageSize }),
  });

// Fetch single duplicate group details
const useFetchDuplicateQuery = (duplicateId: string) =>
  useQuery({
    queryKey: duplicateKeys.detail(duplicateId),
    queryFn: () => endpoints.fetchDuplicate(apiClient, duplicateId),
    enabled: !!duplicateId,
  });

// Fetch duplicate stats
const useFetchDuplicateStatsQuery = (options?: { staleTime?: number }) =>
  useQuery({
    queryKey: duplicateKeys.stats(),
    queryFn: () => endpoints.fetchDuplicateStats(apiClient),
    staleTime: options?.staleTime,
  });

// Detect duplicates mutation
export const useDetectDuplicatesMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (options: DetectDuplicatesRequest = {}) =>
      startJob(() => endpoints.detectDuplicates(apiClient, options)),
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
    }) => endpoints.resolveDuplicate(apiClient, id, keep_photo_hash, trash_others),
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
    mutationFn: (duplicateId: number | string) => endpoints.dismissDuplicate(apiClient, String(duplicateId)),
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
    mutationFn: (duplicateId: number | string) => endpoints.revertDuplicate(apiClient, String(duplicateId)),
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
    mutationFn: (duplicateId: number | string) => endpoints.deleteDuplicate(apiClient, String(duplicateId)),
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
