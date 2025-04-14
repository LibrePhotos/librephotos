import { useQuery } from '@tanstack/react-query';
import { z } from "zod";

import { PigPhoto } from "../types";
import { fetchClient, QueryKeys } from "../../api";

const RecentlyAddedPhotosResponse = z.object({
  results: PigPhoto.array(),
  date: z.string(),
});
type RecentlyAddedPhotosResponse = z.infer<typeof RecentlyAddedPhotosResponse>;

// Fetch recently added photos
export const useFetchRecentlyAddedPhotosQuery = () => useQuery({
  queryKey: [QueryKeys.autoAlbums, 'recentlyAdded'],
  queryFn: async () => {
    const response = await fetchClient.get('/photos/recentlyadded/');
    return RecentlyAddedPhotosResponse.parse(response);
  },
}); 