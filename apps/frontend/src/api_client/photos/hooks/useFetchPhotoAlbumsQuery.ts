import { endpoints, photoKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

export const useFetchPhotoAlbumsQuery = (hash: string) =>
  useQuery({
    queryKey: photoKeys.albums(hash),
    queryFn: async () => {
      if (!hash) {
        return [];
      }
      return endpoints.fetchPhotoAlbums(apiClient, hash);
    },
    enabled: Boolean(hash),
  });
