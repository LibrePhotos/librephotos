import { z } from "zod";

import { api } from "./api";

enum SettingsEndpoints {
  getSettings = "getSettings",
  updateSettings = "updateSettings",
}

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

const settingsApi = api
  .injectEndpoints({
    endpoints: builder => ({
      [SettingsEndpoints.getSettings]: builder.query<SiteSettings, void>({
        query: () => "sitesettings",
        transformResponse: response => SiteSettingsSchema.parse(response),
      }),
      [SettingsEndpoints.updateSettings]: builder.mutation<SiteSettings, Partial<SiteSettings>>({
        query: body => ({
          method: "POST",
          url: "sitesettings",
          body,
        }),
        transformResponse: response => SiteSettingsSchema.parse(response),
      }),
    }),
  })
  .enhanceEndpoints<"SiteSettings">({
    addTagTypes: ["SiteSettings"],
    endpoints: {
      [SettingsEndpoints.getSettings]: {
        providesTags: ["SiteSettings"],
      },
      [SettingsEndpoints.updateSettings]: {
        invalidatesTags: ["SiteSettings"],
      },
    },
  });

export const { useGetSettingsQuery, useUpdateSettingsMutation } = settingsApi;
