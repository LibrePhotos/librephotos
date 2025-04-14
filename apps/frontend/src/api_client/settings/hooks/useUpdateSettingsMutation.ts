import { useMutation } from '@tanstack/react-query';

import { fetchClient, queryClient, QueryKeys } from "../../api";
import { SiteSettings } from "../types";

export const useUpdateSettingsMutation = () => useMutation({
  mutationFn: async (settings: Partial<SiteSettings>) => {
    const response = await fetchClient.post('/sitesettings', settings);
    return SiteSettings.parse(response);
  },
  onSuccess: () => {
    // Invalidate the settings query to refetch
    queryClient.invalidateQueries({ queryKey: [QueryKeys.siteSettings] });
  },
}); 