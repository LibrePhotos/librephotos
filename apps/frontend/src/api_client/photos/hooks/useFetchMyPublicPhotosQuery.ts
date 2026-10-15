import { endpoints, photoGridKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

// The latest `pageSize` of my own public photos, with `count` for all of them (the Sharing overview)
export const useFetchMyPublicPhotosQuery = (pageSize: number) =>
  useQuery({
    queryKey: photoGridKeys.myPublicPhotos(pageSize),
    queryFn: () => endpoints.fetchMyPublicPhotos(apiClient, pageSize),
  });
