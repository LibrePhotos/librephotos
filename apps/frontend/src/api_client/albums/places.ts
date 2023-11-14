import { z } from "zod";

import { DatePhotosGroupSchema, PhotoHashSchema } from "../../actions/photosActions.types";
import { api } from "../api";

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
type PlaceAlbum = z.infer<typeof PlaceAlbumSchema>;
const PlaceAlbumResponseSchema = z.object({ results: PlaceAlbumSchema });

enum Endpoints {
  fetchPlacesAlbums = "fetchPlacesAlbums",
  fetchPlaceAlbum = "fetchPlaceAlbum",
  fetchLocationClusters = "fetchLocationClusters",
}

export const placesAlbumsApi = api
  .injectEndpoints({
    endpoints: builder => ({
      [Endpoints.fetchPlacesAlbums]: builder.query<PlaceAlbumList, void>({
        query: () => "albums/place/list/",
        transformResponse: response => PlacesAlbumsResponseSchema.parse(response).results,
      }),
      [Endpoints.fetchPlaceAlbum]: builder.query<PlaceAlbum, string>({
        query: album_id => `albums/place/${album_id}/`,
        transformResponse: response => PlaceAlbumResponseSchema.parse(response).results,
      }),
      [Endpoints.fetchLocationClusters]: builder.query<LocationClusters, void>({
        query: () => "locclust/",
        transformResponse: response => LocationClustersResponseSchema.parse(response),
      }),
    }),
  })
  .enhanceEndpoints<"PlaceAlbums">({
    addTagTypes: ["PlaceAlbums"],
    endpoints: {
      [Endpoints.fetchPlacesAlbums]: {
        providesTags: ["PlaceAlbums"],
      },
    },
  });

export const { useFetchPlacesAlbumsQuery, useFetchLocationClustersQuery, useFetchPlaceAlbumQuery } = placesAlbumsApi;
