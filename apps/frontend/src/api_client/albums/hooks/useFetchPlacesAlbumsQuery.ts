import { useQuery } from '@tanstack/react-query';
import { z } from "zod";

import { PhotoHash } from "../../photos/types";
import { fetchClient } from "../../api";

export const PlacesAlbumsQueryKeys = ['placesAlbums'] as const;

export const AlbumInfo = z.object({
  id: z.number(),
  title: z.string(),
  cover_photos: PhotoHash.array(),
  photo_count: z.number(),
});

export const PlacesAlbum = AlbumInfo.extend({
  geolocation_level: z.number(),
});

export const PlacesAlbumList = PlacesAlbum.array();

export type PlaceAlbumList = z.infer<typeof PlacesAlbumList>;

export const PlacesAlbumsResponse = z.object({
  results: PlacesAlbumList,
});

export const useFetchPlacesAlbumsQuery = () => useQuery({
  queryKey: [...PlacesAlbumsQueryKeys],
  queryFn: async () => {
    const response = await fetchClient.get('/albums/place/list/');
    return PlacesAlbumsResponse.parse(response).results;
  },
}); 