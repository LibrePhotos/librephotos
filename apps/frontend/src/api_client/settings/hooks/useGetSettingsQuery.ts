import { useQuery } from "@tanstack/react-query";
import { parseWithNotification } from "../../../util/zodUtils";
import { apiClient } from "../../api";
import { settingsKeys } from "../keys";
import { SiteSettings } from "../types";

export const useGetSettingsQuery = () =>
  useQuery({
    queryKey: settingsKeys.site(),
    queryFn: async () => {
      const response = await apiClient.get("/sitesettings");
      return parseWithNotification(SiteSettings, response, "Failed to parse site settings");
    },
  });
