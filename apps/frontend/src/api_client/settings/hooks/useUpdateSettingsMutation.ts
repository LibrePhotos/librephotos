import { useMutation } from "@tanstack/react-query";
import { parseWithNotification } from "../../../util/zodUtils";
import { apiClient, queryClient } from "../../api";
import { settingsKeys } from "../keys";
import { SiteSettings } from "../types";

export const useUpdateSettingsMutation = () =>
  useMutation({
    mutationFn: async (settings: Partial<SiteSettings>) => {
      const response = await apiClient.post("/sitesettings", settings);
      return parseWithNotification(SiteSettings, response, "Failed to parse update settings response");
    },
    onSuccess: () => {
      // Invalidate the settings query to refetch
      queryClient.invalidateQueries({ queryKey: settingsKeys.site() });
    },
  });
