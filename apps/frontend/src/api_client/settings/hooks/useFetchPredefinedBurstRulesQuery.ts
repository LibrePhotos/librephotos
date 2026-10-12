import { useQuery } from "@tanstack/react-query";
import { BurstDetectionRule } from "../../../components/settings/burstDetectionSchema";
import { parseListWithNotification } from "../../../util/zodUtils";
import { apiClient } from "../../api";
import { settingsKeys } from "../keys";

export const useFetchPredefinedBurstRulesQuery = () =>
  useQuery({
    queryKey: settingsKeys.predefinedBurstRules(),
    queryFn: async () => {
      const response = await apiClient.get<string>("/predefinedburstrules/");
      const rules: unknown = JSON.parse(response);
      // Rule by rule: a rule type or option a newer backend added is skipped (and reported),
      // and the Add dialog and "Reset to defaults" keep working with the rest.
      return parseListWithNotification(BurstDetectionRule, rules, "Predefined burst rules");
    },
  });
