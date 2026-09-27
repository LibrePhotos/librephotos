import type { Photo } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

export const PhotoDetailsQueryKeys = ["photoDetails"] as const;

export const useFetchPhotoDetailsQuery = (hash: string, skip: boolean = false) =>
  useQuery({
    queryKey: [...PhotoDetailsQueryKeys, hash],
    queryFn: async () => {
      if (!hash) {
        return null;
      }
      // Deliberately not endpoints.fetchPhotoDetails yet: the web has never
      // validated this response, and the lightbox should not start failing on
      // a field the shared schema is stricter about than the backend.
      return apiClient.get<Photo>(`/photos/${hash}/`);
    },
    enabled: !skip && !!hash,
  });
