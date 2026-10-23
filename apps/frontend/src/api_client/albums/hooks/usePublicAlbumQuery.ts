import { endpoints, photoGridKeys, type PhotoOrder, type PublicAlbum } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { withOrderedGroups } from "../../../util/photoOrder";
import { apiClient, ApiError } from "../../api";
import { usePhotoOrderSelect } from "../../user/hooks/usePhotoOrder";

// A missing album stays null.
const orderedAlbum = (album: PublicAlbum | null, order: PhotoOrder) => album && withOrderedGroups(album, order);

/**
 * A public album by its share slug, for a visitor without a session, or `null`
 * when the slug is unknown or the album is no longer public (404). Its days are in the photo order
 * of a signed-in viewer (#2712), newest first for a visitor.
 */
export const usePublicAlbumQuery = (slug: string) => {
  const { select, ready } = usePhotoOrderSelect(orderedAlbum);
  return useQuery({
    queryKey: photoGridKeys.publicAlbum(slug),
    retry: false,
    queryFn: async () => {
      try {
        return await endpoints.fetchPublicAlbum(apiClient, slug);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    // No slug, no album: the user page without ?album= reads none.
    enabled: ready && Boolean(slug),
    select,
  });
};
