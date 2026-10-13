import { endpoints, stackKeys } from "@librephotos/api-client";
import type { DetectStacksRequest } from "@librephotos/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../api";
import { startJob } from "../jobs/startJob";
import { invalidatePhotoLists } from "../photos/invalidatePhotoLists";
import type { StackPhotosRequest } from "./types";

type StackListParams = { page?: number; page_size?: number; stack_type?: string; ordering?: string };

// Query hooks
export function useStacksQuery(params?: StackListParams) {
  return useQuery({
    queryKey: stackKeys.list(params || {}),
    queryFn: () =>
      endpoints.fetchStacks(apiClient, {
        page: params?.page,
        pageSize: params?.page_size,
        stackType: params?.stack_type,
        ordering: params?.ordering,
      }),
  });
}

export function useStackQuery(id: string) {
  return useQuery({
    queryKey: stackKeys.detail(id),
    queryFn: () => endpoints.fetchStack(apiClient, id),
    enabled: !!id,
  });
}

export function useStackStatsQuery() {
  return useQuery({
    queryKey: stackKeys.stats(),
    queryFn: () => endpoints.fetchStackStats(apiClient),
  });
}

export function useRemoveFromStackMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ stackId, data }: { stackId: string; data: StackPhotosRequest }) =>
      endpoints.removePhotosFromStack(apiClient, stackId, data.photo_hashes),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: stackKeys.detail(variables.stackId) });
      queryClient.invalidateQueries({ queryKey: stackKeys.lists() });
      queryClient.invalidateQueries({ queryKey: stackKeys.stats() });
    },
  });
}

export function useMergeStacksMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: StackPhotosRequest) => endpoints.mergeStacks(apiClient, data.photo_hashes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: stackKeys.lists() });
      queryClient.invalidateQueries({ queryKey: stackKeys.stats() });
      // Stack badges and covers are drawn from the grid data.
      invalidatePhotoLists(queryClient);
    },
  });
}

export function useCreateManualStackMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: StackPhotosRequest) => endpoints.createManualStack(apiClient, data.photo_hashes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: stackKeys.lists() });
      queryClient.invalidateQueries({ queryKey: stackKeys.stats() });
      // Stack badges and covers are drawn from the grid data.
      invalidatePhotoLists(queryClient);
    },
  });
}

export function useDeleteStackMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => endpoints.deleteStack(apiClient, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: stackKeys.lists() });
      queryClient.invalidateQueries({ queryKey: stackKeys.stats() });
    },
  });
}

export function useDetectStacksMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (options?: DetectStacksRequest) => {
      await startJob(() => endpoints.detectStacks(apiClient, options || {}));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: stackKeys.lists() });
      queryClient.invalidateQueries({ queryKey: stackKeys.stats() });
    },
  });
}

export function useSetCoverPhotoMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ stackId, photoHash }: { stackId: string; photoHash: string }) =>
      endpoints.setStackPrimary(apiClient, stackId, photoHash),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: stackKeys.detail(variables.stackId) });
      queryClient.invalidateQueries({ queryKey: stackKeys.lists() });
    },
  });
}
