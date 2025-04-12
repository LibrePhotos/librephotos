import { useQuery } from '@tanstack/react-query';
import { z } from "zod";
import { fetchClient, QueryKeys } from "./api";
import { PigPhotoSchema } from "../actions/photosActions.types";
import { getPhotosFlatFromGroupedByDate } from "../util/util";

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

export const useSearchExamplesQuery = () => useQuery({
  queryKey: [QueryKeys.searchExamples],
  queryFn: async () => {
    const response = await fetchClient.get<{ results: string[] }>('/searchtermexamples/');
    return SearchExamplesResponseSchema.parse(response).results;
  },
});

export const useSearchPhotosQuery = (query: string) => useQuery({
  queryKey: [QueryKeys.searchPhotos, query],
  queryFn: async () => {
    const response = await fetchClient.get<{ results: any }>(`/photos/searchlist/?search=${query}`);
    try {
      const photosGroupedByDate = SearchPhotosSchema.parse(response).results;
      return {
        photosFlat: getPhotosFlatFromGroupedByDate(photosGroupedByDate),
        photosGroupedByDate,
      };
    } catch (e) {
      return {
        photosFlat: response.results,
        photosGroupedByDate: [],
      };
    }
  },
}); 