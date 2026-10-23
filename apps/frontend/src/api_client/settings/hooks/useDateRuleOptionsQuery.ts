import { endpoints, settingsKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

/** The tags a custom date rule may read and check, and where custom rule ids start (#2272). */
export const useDateRuleOptionsQuery = () =>
  useQuery({
    queryKey: settingsKeys.dateRuleOptions(),
    queryFn: () => endpoints.fetchDateRuleOptions(apiClient),
  });
