import { endpoints, settingsKeys } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";

export const useGetSettingsQuery = () =>
  useQuery({
    queryKey: settingsKeys.site(),
    queryFn: () => endpoints.fetchSiteSettings(apiClient),
  });
