import { useQuery } from '@tanstack/react-query';
import { z } from "zod";

import { PhotoHash } from "../../photos/types";
import { fetchClient, QueryKeys } from "../../api";

const ThingsAlbumList = z
  .object({
    id: z.number(),
    title: z.string(),
    cover_photos: PhotoHash.array(),
    photo_count: z.number(),
    thing_type: z.string(),
  })
  .array();

const ThingsAlbumListResponse = z.object({
  results: ThingsAlbumList,
});

export type ThingsAlbumList = z.infer<typeof ThingsAlbumList>;

export const useFetchThingsAlbumsQuery = () => useQuery({
  queryKey: [QueryKeys.thingsAlbums],
  queryFn: async () => {
    const response = await fetchClient.get('/albums/thing/list/');
    return ThingsAlbumListResponse.parse(response).results;
  },
}); 