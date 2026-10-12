import { useQuery } from "@tanstack/react-query";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";
import { settingsKeys } from "../keys";
import { SiteSettings } from "../types";

export const useGetSettingsQuery = () =>
  useQuery({
    queryKey: settingsKeys.site(),
    queryFn: async () => {
      const response = await fetchClient.get("/sitesettings");
      return parseWithNotification(SiteSettings, response, "Failed to parse site settings");
    },
  });
