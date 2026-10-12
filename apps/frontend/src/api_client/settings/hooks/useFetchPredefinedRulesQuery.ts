import { useQuery } from "@tanstack/react-query";
import { DateTimeRule } from "../../../components/settings/dateTimeSchema";
import { parseListWithNotification } from "../../../util/zodUtils";
import { apiClient } from "../../api";
import { settingsKeys } from "../keys";

export const useFetchPredefinedRulesQuery = () =>
  useQuery({
    queryKey: settingsKeys.predefinedRules(),
    queryFn: async () => {
      const response = await apiClient.get<string>("/predefinedrules/");
      const rules: unknown = JSON.parse(response);
      // Rule by rule: a rule type a newer backend added is skipped (and reported), and the Add
      // dialog and "Reset to defaults" keep working with the rest.
      return parseListWithNotification(DateTimeRule, rules, "Predefined date-time rules");
    },
  });
