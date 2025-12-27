import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { parseWithNotification } from "../../util/zodUtils";
import { fetchClient } from "../api";
import {
  AddToStackResponseSchema,
  CreateManualStackResponseSchema,
  DetectStacksResponseSchema,
  MergeStacksResponseSchema,
  RemoveFromStackResponseSchema,
  StackDetailResponseSchema,
  StackListResponseSchema,
  StackStatsResponseSchema,
  type AddToStackRequest,
  type AddToStackResponse,
  type CreateManualStackRequest,
  type CreateManualStackResponse,
  type DetectStacksRequest,
  type DetectStacksResponse,
  type MergeStacksRequest,
  type MergeStacksResponse,
  type RemoveFromStackRequest,
  type RemoveFromStackResponse,
  type StackDetailResponse,
  type StackListResponse,
  type StackStatsResponse,
} from "./types";

// Query keys for cache invalidation
export const stackKeys = {
  all: ["stacks"] as const,
  lists: () => [...stackKeys.all, "list"] as const,
  list: (filters: Record<string, unknown>) => [...stackKeys.lists(), filters] as const,
  details: () => [...stackKeys.all, "detail"] as const,
  detail: (id: number) => [...stackKeys.details(), id] as const,
  stats: () => [...stackKeys.all, "stats"] as const,
};

// API functions
async function fetchStacks(params?: {
  page?: number;
  page_size?: number;
  stack_type?: string;
  ordering?: string;
}): Promise<StackListResponse> {
  const queryParams = new URLSearchParams();
  if (params?.page) queryParams.append("page", String(params.page));
  if (params?.page_size) queryParams.append("page_size", String(params.page_size));
  if (params?.stack_type) queryParams.append("stack_type", params.stack_type);
  if (params?.ordering) queryParams.append("ordering", params.ordering);

  const queryString = queryParams.toString();
  const endpoint = `/stacks${queryString ? `?${queryString}` : ""}`;
  const response = await fetchClient.get<StackListResponse>(endpoint);
  return parseWithNotification(StackListResponseSchema, response, "Failed to parse stacks list");
}

async function fetchStack(id: string): Promise<StackDetailResponse> {
  const response = await fetchClient.get<StackDetailResponse>(`/stacks/${id}/`);
  return parseWithNotification(StackDetailResponseSchema, response, "Failed to parse stack details");
}

async function fetchStackStats(): Promise<StackStatsResponse> {
  const response = await fetchClient.get<StackStatsResponse>("/stacks/stats/");
  return parseWithNotification(StackStatsResponseSchema, response, "Failed to parse stack stats");
}

async function addToStack(stackId: string, data: AddToStackRequest): Promise<AddToStackResponse> {
  const response = await fetchClient.post<AddToStackResponse>(`/stacks/${stackId}/add/`, {
    photo_hashes: data.photo_hashes,
  });
  return parseWithNotification(AddToStackResponseSchema, response, "Failed to parse add to stack response");
}

async function removeFromStack(stackId: string, data: RemoveFromStackRequest): Promise<RemoveFromStackResponse> {
  const response = await fetchClient.post<RemoveFromStackResponse>(`/stacks/${stackId}/remove/`, {
    photo_hashes: data.photo_hashes,
  });
  return parseWithNotification(RemoveFromStackResponseSchema, response, "Failed to parse remove from stack response");
}

async function mergeStacks(data: MergeStacksRequest): Promise<MergeStacksResponse> {
  const response = await fetchClient.post<MergeStacksResponse>("/stacks/merge/", data);
  return parseWithNotification(MergeStacksResponseSchema, response, "Failed to parse merge stacks response");
}

async function createManualStack(data: CreateManualStackRequest): Promise<CreateManualStackResponse> {
  const response = await fetchClient.post<CreateManualStackResponse>("/stacks/manual/", data);
  return parseWithNotification(
    CreateManualStackResponseSchema,
    response,
    "Failed to parse create manual stack response"
  );
}

async function deleteStack(id: string): Promise<void> {
  await fetchClient.delete(`/stacks/${id}/`);
}

async function detectStacks(options?: DetectStacksRequest): Promise<DetectStacksResponse> {
  const response = await fetchClient.post<DetectStacksResponse>("/stacks/detect/", options || {});
  return parseWithNotification(DetectStacksResponseSchema, response, "Failed to parse detect stacks response");
}

async function setCoverPhoto(stackId: string, photoHash: string): Promise<StackDetailResponse> {
  const response = await fetchClient.post<StackDetailResponse>(`/stacks/${stackId}/primary/`, {
    photo_hash: photoHash,
  });
  return parseWithNotification(StackDetailResponseSchema, response, "Failed to parse set cover photo response");
}

// Query hooks
export function useStacksQuery(params?: { page?: number; page_size?: number; stack_type?: string; ordering?: string }) {
  return useQuery({
    queryKey: stackKeys.list(params || {}),
    queryFn: () => fetchStacks(params),
  });
}

export function useStackQuery(id: string) {
  return useQuery({
    queryKey: stackKeys.detail(id),
    queryFn: () => fetchStack(id),
    enabled: !!id,
  });
}

export function useStackStatsQuery() {
  return useQuery({
    queryKey: stackKeys.stats(),
    queryFn: fetchStackStats,
  });
}

// Mutation hooks
export function useAddToStackMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ stackId, data }: { stackId: string; data: AddToStackRequest }) => addToStack(stackId, data),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: stackKeys.detail(variables.stackId) });
      queryClient.invalidateQueries({ queryKey: stackKeys.lists() });
      queryClient.invalidateQueries({ queryKey: stackKeys.stats() });
    },
  });
}

export function useRemoveFromStackMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ stackId, data }: { stackId: string; data: RemoveFromStackRequest }) =>
      removeFromStack(stackId, data),
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
    mutationFn: mergeStacks,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: stackKeys.lists() });
      queryClient.invalidateQueries({ queryKey: stackKeys.stats() });
      // Also invalidate photo queries since stacks affect photo display
      queryClient.invalidateQueries({ queryKey: ["photos"] });
    },
  });
}

export function useCreateManualStackMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createManualStack,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: stackKeys.lists() });
      queryClient.invalidateQueries({ queryKey: stackKeys.stats() });
      // Also invalidate photo queries since stacks affect photo display
      queryClient.invalidateQueries({ queryKey: ["photos"] });
    },
  });
}

export function useDeleteStackMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteStack,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: stackKeys.lists() });
      queryClient.invalidateQueries({ queryKey: stackKeys.stats() });
    },
  });
}

export function useDetectStacksMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (options?: DetectStacksRequest) => detectStacks(options),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: stackKeys.lists() });
      queryClient.invalidateQueries({ queryKey: stackKeys.stats() });
    },
  });
}

export function useSetCoverPhotoMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ stackId, photoHash }: { stackId: string; photoHash: string }) => setCoverPhoto(stackId, photoHash),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: stackKeys.detail(variables.stackId) });
      queryClient.invalidateQueries({ queryKey: stackKeys.lists() });
    },
  });
}
