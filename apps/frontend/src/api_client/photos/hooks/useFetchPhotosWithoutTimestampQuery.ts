import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { z } from "zod";

import { PigPhoto } from "../types";
import { fetchClient, QueryKeys } from "../../api";

const PaginatedPhotosResponse = z.object({
  count: z.number(),
  next: z.string().nullable(),
  previous: z.string().nullable(),
  results: PigPhoto.array(),
});
export type PaginatedPhotosResponse = z.infer<typeof PaginatedPhotosResponse>;

// Fetch photos without timestamp
export const useFetchPhotosWithoutTimestampQuery = (page: number) => useQuery({
  queryKey: [QueryKeys.dateAlbum, 'noTimestamp', page],
  queryFn: async () => {
    const response = await fetchClient.get(`/photos/notimestamp/?page=${page}`);
    return PaginatedPhotosResponse.parse(response);
  },
  placeholderData: keepPreviousData,
}); 