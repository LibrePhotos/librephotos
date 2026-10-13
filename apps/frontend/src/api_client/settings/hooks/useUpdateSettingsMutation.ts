import { endpoints, settingsKeys, type SiteSettings } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { apiClient, queryClient } from "../../api";

export const useUpdateSettingsMutation = () =>
  useMutation({
    mutationFn: (settings: Partial<SiteSettings>) => endpoints.updateSiteSettings(apiClient, settings),
    onSuccess: () => {
      // Invalidate the settings query to refetch
      queryClient.invalidateQueries({ queryKey: settingsKeys.site() });
    },
  });
