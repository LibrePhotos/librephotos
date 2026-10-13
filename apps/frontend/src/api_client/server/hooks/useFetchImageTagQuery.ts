import { endpoints, serverKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

export const useFetchImageTagQuery = () =>
  useQuery({
    queryKey: serverKeys.imageTag(),
    queryFn: () => endpoints.fetchImageTag(apiClient),
  });
