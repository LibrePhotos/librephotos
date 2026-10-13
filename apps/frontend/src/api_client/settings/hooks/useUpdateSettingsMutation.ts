import { endpoints, settingsKeys, type SiteSettingsUpdate } from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api";

export const useUpdateSettingsMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: SiteSettingsUpdate) => endpoints.updateSiteSettings(apiClient, settings),
    onSuccess: settings => {
      // The answer is the settings as GET gives them, so a switch shows what was saved without
      // flipping back while the refetch runs.
      queryClient.setQueryData(settingsKeys.site(), settings);
      void queryClient.invalidateQueries({ queryKey: settingsKeys.site() });
    },
  });
};
