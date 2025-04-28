import { useQuery } from '@tanstack/react-query';

import { fetchClient } from "../../api";
import { SearchPhotos, SemanticSearchPhotos, SearchPhotosResult } from "../types";
import { useCurrentUserSelfDetailsQuery } from "../../user/hooks/useCurrentUserSelfDetailsQuery";

export const SearchPhotosQueryKeys = ['searchPhotos'] as const;

export const useSearchPhotosQuery = (searchTerm: string) => {
  const { data: currentUser } = useCurrentUserSelfDetailsQuery();
  
  return useQuery({
    queryKey: [...SearchPhotosQueryKeys, searchTerm],
    queryFn: async () => {
      const response = await fetchClient.get<typeof SearchPhotos>(`/photos/searchlist/?search=${searchTerm}`);
    
      // If semantic_search_topk is set, return a flat list
      if (currentUser?.semantic_search_topk) {
        const parsed = SemanticSearchPhotos.parse(response)
        return {
          photosFlat: parsed.results,
          photosGroupedByDate: [],
        } satisfies SearchPhotosResult;
      }

      const parsed = SearchPhotos.parse(response);

      return {
        photosFlat: parsed.results.flatMap(group => group.items),
        photosGroupedByDate: parsed.results,
      } satisfies SearchPhotosResult;
    },
    enabled: searchTerm.length > 0,
  });
}; 