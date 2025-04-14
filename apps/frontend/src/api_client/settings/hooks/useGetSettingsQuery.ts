import { useQuery } from '@tanstack/react-query';

import { fetchClient, QueryKeys } from "../../api";
import { SiteSettings } from "../types";

export const useGetSettingsQuery = () => useQuery({
  queryKey: [QueryKeys.siteSettings],
  queryFn: async () => {
    const response = await fetchClient.get('sitesettings');
    return SiteSettings.parse(response);
  },
}); 