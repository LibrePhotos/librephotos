import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { parseWithNotification } from "../../../util/zodUtils";
import { fetchClient } from "../../api";
import { PigPhoto } from "../types";

export const PhotosWithoutTimestampQueryKeys = ["photosWithoutTimestamp"] as const;

const PaginatedPhotosResponse = z.object({
  count: z.number(),
  next: z.string().nullable(),
  previous: z.string().nullable(),
  results: PigPhoto.array(),
});
export type PaginatedPhotosResponse = z.infer<typeof PaginatedPhotosResponse>;

// Fetch photos without timestamp
export const useFetchPhotosWithoutTimestampQuery = (page: number) =>
  useQuery({
    queryKey: [...PhotosWithoutTimestampQueryKeys, page],
    queryFn: async () => {
      const response = await fetchClient.get(`/photos/notimestamp/?page=${page}`);
      return parseWithNotification(PaginatedPhotosResponse, response, "Failed to parse photos without timestamp");
    },
    placeholderData: keepPreviousData,
  });
