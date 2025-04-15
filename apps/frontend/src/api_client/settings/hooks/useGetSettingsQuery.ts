import { useQuery } from '@tanstack/react-query';

import { fetchClient } from "../../api";
import { SiteSettings } from "../types";

export const SiteSettingsQueryKeys = ['siteSettings'] as const;

export const useGetSettingsQuery = () => useQuery({
  queryKey: [...SiteSettingsQueryKeys],
  queryFn: async () => {
    const response = await fetchClient.get('/sitesettings');
    return SiteSettings.parse(response);
  },
}); 