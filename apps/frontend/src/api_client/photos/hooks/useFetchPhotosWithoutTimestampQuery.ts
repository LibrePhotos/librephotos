import { endpoints, type PhotosWithoutTimestampResponse } from "@librephotos/api-client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

export const PhotosWithoutTimestampQueryKeys = ["photosWithoutTimestamp"] as const;

export type PaginatedPhotosResponse = PhotosWithoutTimestampResponse;

// Fetch photos without timestamp
export const useFetchPhotosWithoutTimestampQuery = (page: number) =>
  useQuery({
    queryKey: [...PhotosWithoutTimestampQueryKeys, page],
    queryFn: () => endpoints.fetchPhotosWithoutTimestamp(apiClient, page),
    placeholderData: keepPreviousData,
  });
