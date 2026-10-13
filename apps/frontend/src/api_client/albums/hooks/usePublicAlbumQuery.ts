import { endpoints, photoGridKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient, ApiError } from "../../api";

/**
 * A public album by its share slug, for a visitor without a session, or `null`
 * when the slug is unknown or the album is no longer public (404).
 */
export const usePublicAlbumQuery = (slug: string) =>
  useQuery({
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
  });
