import { useQuery } from "@tanstack/react-query";
import { mediaTypeToParams, type MediaType } from "../../../components/photolist/mediaTypeFilter";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";
import { useCurrentUserSelfDetailsQuery } from "../../user/hooks/useCurrentUserSelfDetailsQuery";
import { SearchPhotos, SearchPhotosResult, SemanticSearchPhotos } from "../types";

export const SearchPhotosQueryKeys = ["searchPhotos"] as const;

export const useSearchPhotosQuery = (searchTerm: string, mediaType?: MediaType) => {
  const { data: currentUser } = useCurrentUserSelfDetailsQuery();

  return useQuery({
    queryKey: [...SearchPhotosQueryKeys, searchTerm, mediaType ?? "all"],
    queryFn: async () => {
      const params = new URLSearchParams({ search: searchTerm, ...mediaTypeToParams(mediaType) });
      const response = await fetchClient.get<typeof SearchPhotos>(`/photos/searchlist/?${params.toString()}`);

      // If semantic_search_topk is set, return a flat list
      if (currentUser?.semantic_search_topk) {
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
    enabled: searchTerm.length > 0,
  });
};
