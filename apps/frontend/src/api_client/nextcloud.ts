import { api } from "./api";
import type { DirTreeResponse } from "./dir-tree";
import { DirTreeResponseSchema } from "./dir-tree";

enum NextcloudEndpoints {
  fetchNextcloudDirs = "fetchNextcloudDirs",
}

export const nextcloudApi = api
  .injectEndpoints({
    endpoints: builder => ({
      [NextcloudEndpoints.fetchNextcloudDirs]: builder.query<DirTreeResponse, void>({
        query: () => `nextcloud/listdir/?fpath=/`,
        transformResponse: response => DirTreeResponseSchema.parse(response),
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
