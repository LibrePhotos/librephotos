import { useMutation, useQuery } from '@tanstack/react-query';
import { z } from "zod";
import { fetchClient, queryClient, QueryKeys } from "./api";

const SiteSettingsSchema = z.object({
  allow_registration: z.boolean(),
  allow_upload: z.boolean(),
  skip_patterns: z.string(),
  map_api_key: z.string(),
  map_api_provider: z.string(),
  captioning_model: z.string(),
  llm_model: z.string(),
});

export type SiteSettings = z.infer<typeof SiteSettingsSchema>;

export const useGetSettingsQuery = () => useQuery({
  queryKey: [QueryKeys.siteSettings],
  queryFn: async () => {
    const response = await fetchClient.get('sitesettings');
    return SiteSettingsSchema.parse(response);
  },
});

export const useUpdateSettingsMutation = () => useMutation({
  mutationFn: async (settings: Partial<SiteSettings>) => {
    const response = await fetchClient.post('/sitesettings', settings);
    return SiteSettingsSchema.parse(response);
  },
  onSuccess: () => {
    // Invalidate the settings query to refetch
    queryClient.invalidateQueries({ queryKey: [QueryKeys.siteSettings] });
  },
}); 