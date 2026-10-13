import { endpoints, photoGridKeys } from "@librephotos/api-client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

// Fetch photos without timestamp
export const useFetchPhotosWithoutTimestampQuery = (page: number) =>
  useQuery({
    queryKey: photoGridKeys.withoutTimestamp(page),
    queryFn: () => endpoints.fetchPhotosWithoutTimestamp(apiClient, page),
    placeholderData: keepPreviousData,
  });
