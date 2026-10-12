import { endpoints } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { serverKeys } from "../keys";

export const useFetchImageTagQuery = () =>
  useQuery({
    queryKey: serverKeys.imageTag(),
    queryFn: () => endpoints.fetchImageTag(apiClient),
  });
