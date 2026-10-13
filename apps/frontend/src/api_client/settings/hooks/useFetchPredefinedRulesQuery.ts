import { endpoints, settingsKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { keepParsedEntries } from "../../parseErrors";

export const useFetchPredefinedRulesQuery = () =>
  useQuery({
    queryKey: settingsKeys.predefinedRules(),
    // Rule by rule: a rule type a newer backend added is skipped (and reported), and the Add
    // dialog and "Reset to defaults" keep working with the rest.
    queryFn: async () =>
      keepParsedEntries("Predefined date-time rules", await endpoints.fetchPredefinedRules(apiClient)),
  });
