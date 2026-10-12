import { endpoints } from "@librephotos/api-client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api";
import { settingsKeys } from "../keys";

export const useGetSettingsQuery = () =>
  useQuery({
    queryKey: settingsKeys.site(),
    queryFn: () => endpoints.fetchSiteSettings(apiClient),
  });
