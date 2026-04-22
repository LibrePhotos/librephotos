import { useMutation } from "@tanstack/react-query";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient, queryClient } from "../../api";
import { SiteSettings } from "../types";

export const SiteSettingsQueryKeys = ["siteSettings"] as const;

export const useUpdateSettingsMutation = () =>
  useMutation({
    mutationFn: async (settings: Partial<SiteSettings>) => {
      const response = await fetchClient.post("/sitesettings", settings);
      return parseWithNotification(SiteSettings, response, "Failed to parse update settings response");
    },
    onSuccess: () => {
      // Invalidate the settings query to refetch
      queryClient.invalidateQueries({ queryKey: [...SiteSettingsQueryKeys] });
    },
  });
