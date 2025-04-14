import { useQuery } from '@tanstack/react-query';
import { z } from "zod";

import { DatePhotosGroup } from "../../photos/types";
import { fetchClient, QueryKeys } from "../../api";

const ThingsAlbum = z.object({
  id: z.string(),
  title: z.string(),
  grouped_photos: DatePhotosGroup.array(),
});

export type ThingsAlbum = z.infer<typeof ThingsAlbum>;

const ThingsAlbumResponse = z.object({
  results: ThingsAlbum,
});

export const useFetchThingsAlbumQuery = (id: string) => useQuery({
  queryKey: [QueryKeys.thingsAlbum, id],
  queryFn: async () => {
    const response = await fetchClient.get(`/albums/thing/${id}/`);
    return ThingsAlbumResponse.parse(response).results;
  },
  enabled: !!id,
}); 