import type { ZodType } from "zod";
import { z } from "zod";

import { api } from "./api";

export interface DirTree {
  title: string;
  absolute_path: string;
  children: DirTree[];
}

export type DirTreeResponse = DirTree[];

export const DirTreeSchema: ZodType<DirTree> = z.lazy(() =>
  z.object({
    title: z.string(),
    absolute_path: z.string(),
    children: z.array(DirTreeSchema),
  })
);

export const DirTreeResponseSchema: ZodType<DirTreeResponse> = z.array(DirTreeSchema);

enum DirTreeEndpoints {
  fetchDirs = "fetchDirs",
}

export const dirTreeApi = api
  .injectEndpoints({
    endpoints: builder => ({
      [DirTreeEndpoints.fetchDirs]: builder.query<DirTreeResponse, string>({
        query: (path: string) => `dirtree/?path=${path}`,
        transformResponse: (response: DirTreeResponse) => DirTreeResponseSchema.parse(response),
      }),
    }),
  })
  .enhanceEndpoints<"DirTree">({
    addTagTypes: ["DirTree"],
    endpoints: {
      [DirTreeEndpoints.fetchDirs]: {
        providesTags: ["DirTree"],
      },
    },
  });

export const { useLazyFetchDirsQuery } = dirTreeApi;
