import { useQuery } from '@tanstack/react-query';
import { z } from "zod";

import { DatePhotosGroupSchema, PhotoHashSchema } from "../../photos/photosActions.types";
import { fetchClient, QueryKeys } from "../../api";

const ThingsAlbumListSchema = z
  .object({
    id: z.number(),
    title: z.string(),
    cover_photos: PhotoHashSchema.array(),
    photo_count: z.number(),
    thing_type: z.string(),
  })
  .array();

const ThingsAlbumListResponseSchema = z.object({
  results: ThingsAlbumListSchema,
});

export type ThingsAlbumList = z.infer<typeof ThingsAlbumListSchema>;

export const useFetchThingsAlbumsQuery = () => useQuery({
  queryKey: [QueryKeys.thingsAlbums],
  queryFn: async () => {
    const response = await fetchClient.get('/albums/thing/list/');
    return ThingsAlbumListResponseSchema.parse(response).results;
  },
}); 