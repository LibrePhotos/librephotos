import { useQuery } from '@tanstack/react-query';
import { z } from "zod";

import { DatePhotosGroupSchema, PhotoHashSchema } from "../../actions/photosActions.types";
import { fetchClient, QueryKeys } from "../tanstack-api";

// Schemas
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

const ThingsAlbumSchema = z.object({
  id: z.string(),
  title: z.string(),
  grouped_photos: DatePhotosGroupSchema.array(),
});

const ThingsAlbumResponseSchema = z.object({
  results: ThingsAlbumSchema,
});

// Types
type ThingsAlbumList = z.infer<typeof ThingsAlbumListSchema>;
type ThingsAlbum = z.infer<typeof ThingsAlbumSchema>;

// Fetch things albums
export const useFetchThingsAlbumsQuery = () => useQuery({
  queryKey: [QueryKeys.thingsAlbums],
  queryFn: async () => {
    const response = await fetchClient.get('/albums/thing/list/');
    return ThingsAlbumListResponseSchema.parse(response).results;
  },
});

// Fetch things album
export const useFetchThingsAlbumQuery = (id: string) => useQuery({
  queryKey: [QueryKeys.thingsAlbum, id],
  queryFn: async () => {
    const response = await fetchClient.get(`/albums/thing/${id}/`);
    return ThingsAlbumResponseSchema.parse(response).results;
  },
  enabled: !!id,
}); 