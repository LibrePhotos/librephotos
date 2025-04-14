import { useQuery } from '@tanstack/react-query';

import { fetchClient, QueryKeys } from "../../api";
import { PredefinedRules } from "../types";

export const useFetchPredefinedRulesQuery = () => useQuery({
  queryKey: [QueryKeys.predefinedRules],
  queryFn: async () => {
    const response = await fetchClient.get<string>('/predefinedrules/');
    return JSON.parse(response) as PredefinedRules;
  },
}); 