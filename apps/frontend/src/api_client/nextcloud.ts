import { z } from "zod";

import { api } from "./api";

const NextcloudDirEntrySchema = z.object({
  absolute_path: z.string(),
  title: z.string(),
  children: z.array(z.any()),
});

const NextcloudDirsResponseSchema = z.array(NextcloudDirEntrySchema);

export type NextcloudDirsResponse = z.infer<typeof NextcloudDirsResponseSchema>;

enum NextcloudEndpoints {
  fetchNextcloudDirs = "fetchNextcloudDirs",
}

export const nextcloudApi = api
  .injectEndpoints({
    endpoints: builder => ({
      [NextcloudEndpoints.fetchNextcloudDirs]: builder.query<NextcloudDirsResponse, void>({
        query: () => `nextcloud/listdir/?fpath=/`,
        transformResponse: response => NextcloudDirsResponseSchema.parse(response),
      }),
    }),
  })
  .enhanceEndpoints<"NextcloudDirs">({
    addTagTypes: ["NextcloudDirs"],
    endpoints: {
      [NextcloudEndpoints.fetchNextcloudDirs]: {
        providesTags: ["NextcloudDirs"],
      },
    },
  });

export const { useFetchNextcloudDirsQuery, useLazyFetchNextcloudDirsQuery } = nextcloudApi;
