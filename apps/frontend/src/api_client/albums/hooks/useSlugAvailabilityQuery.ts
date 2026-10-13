import { albumKeys, endpoints, ResponseParseError } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient, ApiError } from "../../api";

/**
 * Which album holds a public share slug: its id (a number, also when an older
 * server sends it as a string), `"__exists__"` when the
 * answer has no id, or `null` when the slug is free. Any HTTP error counts as
 * free (404 is the normal answer), so a failed check never blocks saving.
 */
export const useSlugAvailabilityQuery = (slug: string, enabled: boolean) =>
  useQuery({
    queryKey: albumKeys.slugOwner(slug),
    enabled,
    queryFn: async () => {
      try {
        return await endpoints.fetchPublicAlbumSlugOwner(apiClient, slug);
      } catch (error) {
        if (error instanceof ResponseParseError) return "__exists__";
        if (error instanceof ApiError) return null;
        throw error;
      }
    },
    staleTime: 30_000,
    retry: false,
  });
