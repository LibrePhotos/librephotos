import { useQuery } from "@tanstack/react-query";
import { fetchClient } from "../../api";
import { PredefinedRules } from "../types";

export const PredefinedRulesQueryKeys = ["predefinedRules"] as const;

export const useFetchPredefinedRulesQuery = () =>
  useQuery({
    queryKey: [...PredefinedRulesQueryKeys],
    queryFn: async () => {
      const response = await fetchClient.get<string>("/predefinedrules/");
      return JSON.parse(response) as PredefinedRules;
    },
  });
