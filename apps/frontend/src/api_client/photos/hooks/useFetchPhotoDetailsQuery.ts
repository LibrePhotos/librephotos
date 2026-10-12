import { endpoints } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { photoKeys } from "../keys";

export const useFetchPhotoDetailsQuery = (hash: string, skip: boolean = false) =>
  useQuery({
    queryKey: photoKeys.detail(hash),
    queryFn: async () => {
      if (!hash) {
        return null;
      }
      return endpoints.fetchPhotoDetails(apiClient, hash);
    },
    enabled: !skip && !!hash,
  });
