import { endpoints, photoKeys, pollWhile, type Photo } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

/** The server is still making the full-size picture of a saved edit (photo editing). */
const renditionPending = (photo: Photo | null) => photo?.edit?.rendition === "pending";

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
    // Until the edited full-size picture is ready, the lightbox zooms on the thumbnail: ask again.
    refetchInterval: pollWhile(renditionPending, false),
  });
