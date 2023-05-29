import { z } from "zod";

import { api } from "./api";

const SearchExamplesSchema = z.array(z.string());
const SearchExamplesResponseSchema = z.object({
  results: SearchExamplesSchema,
});
type SearchExamples = z.infer<typeof SearchExamplesSchema>;

enum Endpoints {
  fetchSearchExamples = "fetchSearchExamples",
}

const searchApi = api
  .injectEndpoints({
    endpoints: builder => ({
      [Endpoints.fetchSearchExamples]: builder.query<SearchExamples, void>({
        query: () => "searchtermexamples/",
        transformResponse: response => SearchExamplesResponseSchema.parse(response).results,
      }),
    }),
  })
  .enhanceEndpoints<"SearchExamples">({
    addTagTypes: ["SearchExamples"],
    endpoints: {
      [Endpoints.fetchSearchExamples]: {
        providesTags: ["SearchExamples"],
      },
    },
  });

export const { useFetchSearchExamplesQuery } = searchApi;
