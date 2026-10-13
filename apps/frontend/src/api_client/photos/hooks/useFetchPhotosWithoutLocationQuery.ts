import { endpoints, photoGridKeys } from "@librephotos/api-client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

// Fetch photos without GPS coordinates
export const useFetchPhotosWithoutLocationQuery = (page: number) =>
  useQuery({
    queryKey: photoGridKeys.withoutLocation(page),
    queryFn: () => endpoints.fetchPhotosWithoutLocation(apiClient, page),
    placeholderData: keepPreviousData,
  });
