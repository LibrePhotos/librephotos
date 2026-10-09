import { useQuery } from "@tanstack/react-query";
import { DateTimeRule } from "../../../components/settings/date-time.zod";
import { parseListWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";

export const PredefinedRulesQueryKeys = ["predefinedRules"] as const;

export const useFetchPredefinedRulesQuery = () =>
  useQuery({
    queryKey: [...PredefinedRulesQueryKeys],
    queryFn: async () => {
      const response = await fetchClient.get<string>("/predefinedrules/");
      const rules: unknown = JSON.parse(response);
      // Rule by rule: a rule type a newer backend added is skipped (and reported), and the Add
      // dialog and "Reset to defaults" keep working with the rest.
      return parseListWithNotification(DateTimeRule, rules, "Predefined date-time rules");
    },
  });
