import { useQuery } from '@tanstack/react-query';
import { z } from "zod";

import { DatePhotosGroup } from "../../photos/types";
import { fetchClient } from "../../api";

const ThingsAlbum = z.object({
  id: z.string(),
  title: z.string(),
  grouped_photos: DatePhotosGroup.array(),
});

export type ThingsAlbum = z.infer<typeof ThingsAlbum>;

const ThingsAlbumResponse = z.object({
  results: ThingsAlbum,
});

export const ThingsAlbumQueryKeys = ['thingsAlbum'] as const;

export const useFetchThingsAlbumQuery = (id: string) => useQuery({
  queryKey: [...ThingsAlbumQueryKeys, id],
  queryFn: async () => {
    const response = await fetchClient.get(`/albums/thing/${id}/`);
    return ThingsAlbumResponse.parse(response).results;
  },
  enabled: !!id,
}); 