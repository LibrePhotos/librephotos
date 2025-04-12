import { useQuery } from '@tanstack/react-query';
import { z } from "zod";

import { DatePhotosGroupSchema, PhotoHashSchema } from "../../../actions/photosActions.types";
import { fetchClient, QueryKeys } from "../../api";

const AlbumInfoSchema = z.object({
  id: z.number(),
  title: z.string(),
  cover_photos: PhotoHashSchema.array(),
  photo_count: z.number(),
});

const PlacesAlbumSchema = AlbumInfoSchema.extend({
  geolocation_level: z.number(),
});

const PlacesAlbumListSchema = PlacesAlbumSchema.array();

export type PlaceAlbumList = z.infer<typeof PlacesAlbumListSchema>;

const PlacesAlbumsResponseSchema = z.object({
  results: PlacesAlbumListSchema,
});

export const useFetchPlacesAlbumsQuery = () => useQuery({
  queryKey: [QueryKeys.placesAlbums],
  queryFn: async () => {
    const response = await fetchClient.get('/albums/place/list/');
    return PlacesAlbumsResponseSchema.parse(response).results;
  },
}); 