import { useQuery } from '@tanstack/react-query';
import { z } from "zod";

import { DatePhotosGroupSchema } from "../../../actions/photosActions.types";
import { fetchClient, QueryKeys } from "../../api";

const ThingsAlbumSchema = z.object({
  id: z.string(),
  title: z.string(),
  grouped_photos: DatePhotosGroupSchema.array(),
});

export type ThingsAlbum = z.infer<typeof ThingsAlbumSchema>;

const ThingsAlbumResponseSchema = z.object({
  results: ThingsAlbumSchema,
});

export const useFetchThingsAlbumQuery = (id: string) => useQuery({
  queryKey: [QueryKeys.thingsAlbum, id],
  queryFn: async () => {
    const response = await fetchClient.get(`/albums/thing/${id}/`);
    return ThingsAlbumResponseSchema.parse(response).results;
  },
  enabled: !!id,
}); 