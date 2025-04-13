import { useQuery } from '@tanstack/react-query';
import { z } from "zod";

import { PigPhotoSchema } from "./photosActions.types";
import { fetchClient, QueryKeys } from "../api";

const RecentlyAddedPhotosResponseSchema = z.object({
  results: PigPhotoSchema.array(),
  date: z.string(),
});
type RecentlyAddedPhotosResponse = z.infer<typeof RecentlyAddedPhotosResponseSchema>;

// Fetch recently added photos
export const useFetchRecentlyAddedPhotosQuery = () => useQuery({
  queryKey: [QueryKeys.autoAlbums, 'recentlyAdded'],
  queryFn: async () => {
    const response = await fetchClient.get('/photos/recentlyadded/');
    return RecentlyAddedPhotosResponseSchema.parse(response);
  },
}); 