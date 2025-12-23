import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchClient } from "../api";
import type {
  DuplicateGroup,
  DuplicateGroupListResponse,
  DuplicateSensitivity,
  DuplicateStats,
  ResolveDuplicateRequest,
} from "./types";

// Query keys
export const DuplicatesQueryKeys = {
  all: ["duplicates"] as const,
  list: (status?: string, page?: number, pageSize?: number) =>
    [...DuplicatesQueryKeys.all, "list", status, page, pageSize] as const,
  detail: (id: number) => [...DuplicatesQueryKeys.all, "detail", id] as const,
  stats: () => [...DuplicatesQueryKeys.all, "stats"] as const,
};

// Fetch duplicate groups list with pagination
export const useFetchDuplicateGroupsQuery = (
  status?: string,
  page: number = 1,
  pageSize: number = 20
) => {
  const params = new URLSearchParams();
  if (status) params.append("status", status);
  params.append("page", String(page));
  params.append("page_size", String(pageSize));

  return useQuery({
    queryKey: DuplicatesQueryKeys.list(status, page, pageSize),
    queryFn: () => fetchClient.get<DuplicateGroupListResponse>(`/duplicates?${params.toString()}`),
  });
};

// Fetch single duplicate group details
export const useFetchDuplicateGroupQuery = (groupId: number) =>
  useQuery({
    queryKey: DuplicatesQueryKeys.detail(groupId),
    queryFn: () => fetchClient.get<DuplicateGroup>(`/duplicates/${groupId}`),
    enabled: groupId > 0,
  });

// Fetch duplicate stats
export const useFetchDuplicateStatsQuery = () =>
  useQuery({
    queryKey: DuplicatesQueryKeys.stats(),
    queryFn: () => fetchClient.get<DuplicateStats>("/duplicates/stats"),
  });

// Detect duplicates mutation with sensitivity and clearExisting options
export const useDetectDuplicatesMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sensitivity = "normal", clearExisting = false }: { sensitivity?: DuplicateSensitivity; clearExisting?: boolean } = {}) =>
      fetchClient.post<{ status: string; message: string; threshold: number; sensitivity: string }>(
        "/duplicates/detect",
        { sensitivity, clear_existing: clearExisting }
      ),
    onSuccess: () => {
      // Invalidate stats to show updated detection status
      queryClient.invalidateQueries({ queryKey: DuplicatesQueryKeys.stats() });
    },
  });
};

// Resolve duplicate group mutation
export const useResolveDuplicateGroupMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, data }: { groupId: number; data: ResolveDuplicateRequest }) =>
      fetchClient.post<{ status: string; kept_photo: string; trashed_count: number }>(
        `/duplicates/${groupId}/resolve`,
        data
      ),
    onSuccess: (_, { groupId }) => {
      // Invalidate the specific group and the list
      queryClient.invalidateQueries({ queryKey: DuplicatesQueryKeys.detail(groupId) });
      queryClient.invalidateQueries({ queryKey: DuplicatesQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: DuplicatesQueryKeys.stats() });
    },
  });
};

// Dismiss duplicate group mutation
export const useDismissDuplicateGroupMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (groupId: number) =>
      fetchClient.post<{ status: string }>(`/duplicates/${groupId}/dismiss`, {}),
    onSuccess: (_, groupId) => {
      // Invalidate the specific group and the list
      queryClient.invalidateQueries({ queryKey: DuplicatesQueryKeys.detail(groupId) });
      queryClient.invalidateQueries({ queryKey: DuplicatesQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: DuplicatesQueryKeys.stats() });
    },
  });
};

// Revert duplicate group mutation (restore trashed photos, reset to pending)
export const useRevertDuplicateGroupMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (groupId: number) =>
      fetchClient.post<{ status: string; restored_count: number }>(`/duplicates/${groupId}/revert`, {}),
    onSuccess: (_, groupId) => {
      // Invalidate the specific group and the list
      queryClient.invalidateQueries({ queryKey: DuplicatesQueryKeys.detail(groupId) });
      queryClient.invalidateQueries({ queryKey: DuplicatesQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: DuplicatesQueryKeys.stats() });
    },
  });
};

// Delete duplicate group mutation (unlinks photos, removes group)
export const useDeleteDuplicateGroupMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (groupId: number) =>
      fetchClient.delete<{ status: string; unlinked_count: number }>(`/duplicates/${groupId}/delete`),
    onSuccess: (_, groupId) => {
      // Invalidate the specific group and the list
      queryClient.invalidateQueries({ queryKey: DuplicatesQueryKeys.detail(groupId) });
      queryClient.invalidateQueries({ queryKey: DuplicatesQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: DuplicatesQueryKeys.stats() });
    },
  });
};
