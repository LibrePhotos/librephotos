import { useQuery } from '@tanstack/react-query';
import { z } from "zod";
import { fetchClient, QueryKeys } from "./api";
import { PigPhoto } from "./photos/types";
import { getPhotosFlatFromGroupedByDate } from "../util/util";

const SearchExamples = z.array(z.string());
const SearchExamplesResponse = z.object({
  results: SearchExamples,
});
type SearchExamples = z.infer<typeof SearchExamples>;

const PhotosGroupedByDate = z.array(
  z.object({
    date: z.string(),
    location: z.string(),
    items: z.array(PigPhoto),
  })
);

const SearchPhotos = z.object({
  results: PhotosGroupedByDate,
});

const SearchPhotosResult = z.object({
  photosFlat: z.array(PigPhoto),
  photosGroupedByDate: PhotosGroupedByDate,
});

type SearchPhotosResult = z.infer<typeof SearchPhotosResult>;

export const useSearchExamplesQuery = () => useQuery({
  queryKey: [QueryKeys.searchExamples],
  queryFn: async () => {
    const response = await fetchClient.get<{ results: string[] }>('/searchtermexamples/');
    return SearchExamplesResponse.parse(response).results;
  },
});

export const useSearchPhotosQuery = (query: string) => useQuery({
  queryKey: [QueryKeys.searchPhotos, query],
  queryFn: async () => {
    const response = await fetchClient.get<{ results: any }>(`/photos/searchlist/?search=${query}`);
    try {
      const photosGroupedByDate = SearchPhotos.parse(response).results;
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