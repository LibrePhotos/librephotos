import { useQuery } from "@tanstack/react-query";
import { BurstDetectionRule } from "../../../components/settings/burst-detection.zod";
import { parseListWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";

export const PredefinedBurstRulesQueryKeys = ["predefinedBurstRules"] as const;

export const useFetchPredefinedBurstRulesQuery = () =>
  useQuery({
    queryKey: [...PredefinedBurstRulesQueryKeys],
    queryFn: async () => {
      const response = await fetchClient.get<string>("/predefinedburstrules/");
      const rules: unknown = JSON.parse(response);
      // Rule by rule: a rule type or option a newer backend added is skipped (and reported),
      // and the Add dialog and "Reset to defaults" keep working with the rest.
      return parseListWithNotification(BurstDetectionRule, rules, "Predefined burst rules");
    },
  });
