import { useQuery } from '@tanstack/react-query';

import { fetchClient } from "../../api";
import { SearchExamplesResponse } from "../types";

export const SearchExamplesQueryKeys = ['searchExamples'] as const;

export const useSearchExamplesQuery = () => useQuery({
  queryKey: [...SearchExamplesQueryKeys],
  queryFn: async () => {
    const response = await fetchClient.get<{ results: string[] }>('/searchtermexamples/');
    return SearchExamplesResponse.parse(response).results;
  },
}); 