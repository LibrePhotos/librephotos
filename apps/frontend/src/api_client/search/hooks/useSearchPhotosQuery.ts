import { useQuery } from '@tanstack/react-query';

import { fetchClient, QueryKeys } from "../../api";
import { SearchPhotos, SearchPhotosResult } from "../types";

export const useSearchPhotosQuery = (searchTerm: string) => useQuery({
  queryKey: [QueryKeys.searchPhotos, searchTerm],
  queryFn: async () => {
    const response = await fetchClient.get<typeof SearchPhotos>(`/search/?search=${searchTerm}`);
    const parsed = SearchPhotos.parse(response);
    return {
      photosFlat: parsed.results.flatMap(group => group.items),
      photosGroupedByDate: parsed.results,
    } satisfies SearchPhotosResult;
  },
  enabled: searchTerm.length > 0,
}); 