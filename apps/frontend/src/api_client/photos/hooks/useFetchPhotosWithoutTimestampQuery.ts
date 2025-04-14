import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { z } from "zod";

import { PigPhoto } from "../types";
import { fetchClient } from "../../api";

export const PhotosWithoutTimestampQueryKeys = ["photosWithoutTimestamp"] as const;

const PaginatedPhotosResponse = z.object({
  count: z.number(),
  next: z.string().nullable(),
  previous: z.string().nullable(),
  results: PigPhoto.array(),
});
export type PaginatedPhotosResponse = z.infer<typeof PaginatedPhotosResponse>;

// Fetch photos without timestamp
export const useFetchPhotosWithoutTimestampQuery = (page: number) => useQuery({
  queryKey: [...PhotosWithoutTimestampQueryKeys, page],
  queryFn: async () => {
    const response = await fetchClient.get(`/photos/notimestamp/?page=${page}`);
    return PaginatedPhotosResponse.parse(response);
  },
  placeholderData: keepPreviousData,
}); 