import { useQuery } from "@tanstack/react-query";
import { mediaTypeToParams, type MediaType } from "../../../components/photolist/mediaTypeFilter";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";
import { useCurrentUserSelfDetailsQuery } from "../../user/hooks/useCurrentUserSelfDetailsQuery";
import { SearchPhotos, SearchPhotosResult, SemanticSearchPhotos } from "../types";

export const SearchPhotosQueryKeys = ["searchPhotos"] as const;

export const useSearchPhotosQuery = (searchTerm: string, mediaType?: MediaType) => {
  const { data: currentUser, isError: userFailed } = useCurrentUserSelfDetailsQuery();
  // The backend picks the response shape from this user setting, so the query
  // waits for the user (on a hard load of /search/<q> it is not loaded yet, and
  // a flat semantic result parsed as date groups failed with a toast) and is
  // keyed by it (switching the setting must not reuse the other shape). If the
  // user cannot be loaded, search anyway with the default shape rather than
  // never sending the query.
  const semantic = (currentUser?.semantic_search_topk ?? 0) > 0;

  return useQuery({
    queryKey: [...SearchPhotosQueryKeys, searchTerm, mediaType ?? "all", semantic ? "semantic" : "grouped"],
    queryFn: async () => {
      const params = new URLSearchParams({ search: searchTerm, ...mediaTypeToParams(mediaType) });
      const response = await fetchClient.get(`/photos/searchlist/?${params.toString()}`);

      // If semantic_search_topk is set, return a flat list
      if (semantic) {
        const parsed = parseWithNotification(SemanticSearchPhotos, response, "Failed to parse semantic search photos");
        return {
          photosFlat: parsed.results,
          photosGroupedByDate: [],
        } satisfies SearchPhotosResult;
      }

      const parsed = parseWithNotification(SearchPhotos, response, "Failed to parse search photos");

      return {
        photosFlat: parsed.results.flatMap(group => group.items),
        photosGroupedByDate: parsed.results,
      } satisfies SearchPhotosResult;
    },
    enabled: searchTerm.length > 0 && (currentUser !== undefined || userFailed),
  });
};
