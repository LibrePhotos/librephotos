import { endpoints, settingsKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { keepParsedEntries } from "../../parseErrors";

export const useFetchPredefinedBurstRulesQuery = () =>
  useQuery({
    queryKey: settingsKeys.predefinedBurstRules(),
    // Rule by rule: a rule type or option a newer backend added is skipped (and reported),
    // and the Add dialog and "Reset to defaults" keep working with the rest.
    queryFn: async () =>
      keepParsedEntries("Predefined burst rules", await endpoints.fetchPredefinedBurstRules(apiClient)),
  });
