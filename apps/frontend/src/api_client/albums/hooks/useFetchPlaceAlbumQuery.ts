import { useQuery } from '@tanstack/react-query';
import { z } from "zod";

import { DatePhotosGroupSchema } from "../../photos/photosActions.types";
import { fetchClient, QueryKeys } from "../../api";

const PlaceAlbumSchema = z.object({
  id: z.string(),
  title: z.string(),
  grouped_photos: DatePhotosGroupSchema.array(),
});

export type PlaceAlbum = z.infer<typeof PlaceAlbumSchema>;

const PlaceAlbumResponseSchema = z.object({ results: PlaceAlbumSchema });

export const useFetchPlaceAlbumQuery = (albumId: string) => useQuery({
  queryKey: [QueryKeys.placeAlbum, albumId],
  queryFn: async () => {
    const response = await fetchClient.get(`/albums/place/${albumId}/`);
    return PlaceAlbumResponseSchema.parse(response).results;
  },
  enabled: !!albumId,
}); 