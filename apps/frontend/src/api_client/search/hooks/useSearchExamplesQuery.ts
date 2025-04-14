import { useQuery } from '@tanstack/react-query';

import { fetchClient, QueryKeys } from "../../api";
import { SearchExamplesResponse } from "../types";

export const useSearchExamplesQuery = () => useQuery({
  queryKey: [QueryKeys.searchExamples],
  queryFn: async () => {
    const response = await fetchClient.get<{ results: string[] }>('/searchtermexamples/');
    return SearchExamplesResponse.parse(response).results;
  },
}); 