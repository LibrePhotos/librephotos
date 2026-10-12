import { useQuery } from "@tanstack/react-query";
import { apiClient, ApiError } from "../../api";
import { albumKeys } from "../keys";

/**
 * Which album holds a public share slug: its id, `"__exists__"` when the
 * answer has no id, or `null` when the slug is free. Any HTTP error counts as
 * free (404 is the normal answer), so a failed check never blocks saving.
 */
export const useSlugAvailabilityQuery = (slug: string, enabled: boolean) =>
  useQuery({
    queryKey: albumKeys.slugOwner(slug),
    enabled,
    queryFn: async () => {
      try {
        const data = await apiClient.get(`/public/albums/s/${encodeURIComponent(slug)}/`);
        const album = typeof data === "object" && data !== null && "results" in data ? data.results : undefined;
        const id = typeof album === "object" && album !== null && "id" in album ? album.id : undefined;
        return typeof id === "string" || typeof id === "number" ? id : "__exists__";
      } catch (error) {
        if (error instanceof ApiError) return null;
        throw error;
      }
    },
    staleTime: 30_000,
    retry: false,
  });
