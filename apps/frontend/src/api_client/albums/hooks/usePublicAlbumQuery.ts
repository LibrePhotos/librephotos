import { useQuery } from "@tanstack/react-query";
import { parseWithNotification } from "../../../util/zodUtils";
import { apiClient, ApiError } from "../../api";
import { photoGridKeys } from "../../photos/keys";
import { UserAlbum } from "../types";

/**
 * A public album by its share slug, for a visitor without a session, or `null`
 * when the slug is unknown or the album is no longer public (404).
 */
export const usePublicAlbumQuery = (slug: string) =>
  useQuery({
    queryKey: photoGridKeys.publicAlbum(slug),
    retry: false,
    queryFn: async () => {
      let json: unknown;
      try {
        json = await apiClient.get(`/public/albums/s/${encodeURIComponent(slug)}/`);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
      const results = typeof json === "object" && json !== null && "results" in json ? json.results : undefined;
      return parseWithNotification(UserAlbum, results, "Failed to parse public album");
    },
  });
