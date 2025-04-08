import { useQuery } from '@tanstack/react-query';
import { z } from "zod";

import { DatePhotosGroupSchema, PhotoHashSchema } from "../../actions/photosActions.types";
import { fetchClient, QueryKeys } from "../tanstack-api";

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

const LocationClustersResponseSchema = z.array(z.array(z.union([z.number(), z.string()])));
export type LocationClusters = z.infer<typeof LocationClustersResponseSchema>;

const PlaceAlbumSchema = z.object({
  id: z.string(),
  title: z.string(),
  grouped_photos: DatePhotosGroupSchema.array(),
});
export type PlaceAlbum = z.infer<typeof PlaceAlbumSchema>;
const PlaceAlbumResponseSchema = z.object({ results: PlaceAlbumSchema });

// Fetch places albums
export const useFetchPlacesAlbumsQuery = () => useQuery({
  queryKey: [QueryKeys.placesAlbums],
  queryFn: async () => {
    const response = await fetchClient.get('/albums/place/list/');
    return PlacesAlbumsResponseSchema.parse(response).results;
  },
});

// Fetch a specific place album
export const useFetchPlaceAlbumQuery = (albumId: string) => useQuery({
  queryKey: [QueryKeys.placeAlbum, albumId],
  queryFn: async () => {
    const response = await fetchClient.get(`/albums/place/${albumId}/`);
    return PlaceAlbumResponseSchema.parse(response).results;
  },
  enabled: !!albumId,
});

// Fetch location clusters
export const useFetchLocationClustersQuery = () => useQuery({
  queryKey: [QueryKeys.locationClusters],
  queryFn: async () => {
    const response = await fetchClient.get('/locclust/');
    return LocationClustersResponseSchema.parse(response);
  },
}); 