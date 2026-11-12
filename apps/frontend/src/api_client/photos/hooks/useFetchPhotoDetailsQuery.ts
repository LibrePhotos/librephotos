import { endpoints, photoGridKeys, photoKeys, pollWhile, type Photo } from "@librephotos/api-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api";

/** The server is still making the full-size picture of a saved edit (photo editing). */
const renditionPending = (photo: Photo | null) => photo?.edit?.rendition === "pending";

export const useFetchPhotoDetailsQuery = (hash: string, skip: boolean = false) => {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: photoKeys.detail(hash),
    queryFn: async () => {
      if (!hash) {
        return null;
      }
      const before = queryClient.getQueryData<Photo | null>(photoKeys.detail(hash));
      const photo = await endpoints.fetchPhotoDetails(apiClient, hash);
      // The rendition is ready: the server may have made the thumbnails again from it (a tight crop
      // saved a smaller render), and the grid summaries' thumbnail_version moved with it.
      if (renditionPending(before ?? null) && photo.edit?.rendition === "ready") {
        void queryClient.invalidateQueries({ queryKey: photoGridKeys.all });
      }
      return photo;
    },
    enabled: !skip && !!hash,
    // Until the edited full-size picture is ready, the lightbox zooms on the thumbnail: ask again.
    refetchInterval: pollWhile(renditionPending, false),
  });
};
