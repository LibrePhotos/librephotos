import { useQuery } from "@tanstack/react-query";
import type { BurstDetectionRule } from "../../../components/settings/burst-detection.zod";
import { fetchClient } from "../../api";

export const PredefinedBurstRulesQueryKeys = ["predefinedBurstRules"] as const;

export const useFetchPredefinedBurstRulesQuery = () =>
  useQuery({
    queryKey: [...PredefinedBurstRulesQueryKeys],
    queryFn: async () => {
      const response = await fetchClient.get<string>("/predefinedburstrules/");
      return JSON.parse(response) as BurstDetectionRule[];
    },
  });
