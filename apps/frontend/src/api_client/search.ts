import { z } from "zod";

import { PigPhotoSchema } from "../actions/photosActions.types";
import { getPhotosFlatFromGroupedByDate } from "../util/util";
import { api } from "./api";

const SearchExamplesSchema = z.array(z.string());
const SearchExamplesResponseSchema = z.object({
  results: SearchExamplesSchema,
});
type SearchExamples = z.infer<typeof SearchExamplesSchema>;

const PhotosGroupedByDate = z.array(
  z.object({
    date: z.string(),
    location: z.string(),
    items: z.array(PigPhotoSchema),
  })
);

const SearchPhotosSchema = z.object({
  results: PhotosGroupedByDate,
});

const SearchPhotosResultScheme = z.object({
  photosFlat: z.array(PigPhotoSchema),
  photosGroupedByDate: PhotosGroupedByDate,
});

type SearchPhotosResult = z.infer<typeof SearchPhotosResultScheme>;

enum Endpoints {
  searchExamples = "searchExamples",
  searchPhotos = "searchPhotos",
}

const searchApi = api
  .injectEndpoints({
    endpoints: builder => ({
      [Endpoints.searchExamples]: builder.query<SearchExamples, void>({
        query: () => "searchtermexamples/",
        transformResponse: response => SearchExamplesResponseSchema.parse(response).results,
      }),
      [Endpoints.searchPhotos]: builder.query<SearchPhotosResult, string>({
        query: query => `photos/searchlist/?search=${query}`,
        transformResponse: response => {
          const photosGroupedByDate = SearchPhotosSchema.parse(response).results;
          return {
            photosFlat: getPhotosFlatFromGroupedByDate(photosGroupedByDate),
            photosGroupedByDate,
          };
        },
      }),
    }),
  })
  .enhanceEndpoints<"SearchExamples" | "SearchPhotos">({
    addTagTypes: ["SearchExamples", "SearchPhotos"],
    endpoints: {
      [Endpoints.searchExamples]: {
        providesTags: ["SearchExamples"],
      },
      [Endpoints.searchPhotos]: {
        providesTags: ["SearchPhotos"],
      },
    },
  });

export const { useSearchExamplesQuery, useSearchPhotosQuery } = searchApi;
