import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { z } from "zod";

import { PigPhotoSchema } from "./photosActions.types";
import { fetchClient, queryClient, QueryKeys } from "../api";
import { addTempElementsToFlatList } from "../../util/util";

const PaginatedPhotosResponseSchema = z.object({
  count: z.number(),
  next: z.string().nullable(),
  previous: z.string().nullable(),
  results: PigPhotoSchema.array(),
});
export type PaginatedPhotosResponse = z.infer<typeof PaginatedPhotosResponseSchema>;

// Fetch photos without timestamp
export const useFetchPhotosWithoutTimestampQuery = (page: number) => useQuery({
  queryKey: [QueryKeys.dateAlbum, 'noTimestamp', page],
  queryFn: async () => {
    const response = await fetchClient.get(`/photos/notimestamp/?page=${page}`);
    return PaginatedPhotosResponseSchema.parse(response);
  },
  placeholderData: keepPreviousData,
}); 