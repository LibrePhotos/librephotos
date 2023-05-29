import { z } from "zod";

import { PhotoHashSchema } from "../../actions/photosActions.types";
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

enum Endpoints {
  fetchPlacesAlbums = "fetchPlacesAlbums",
  fetchLocationClusters = "fetchLocationClusters",
}

export const placesAlbumsApi = api
  .injectEndpoints({
    endpoints: builder => ({
      [Endpoints.fetchPlacesAlbums]: builder.query<PlaceAlbumList, void>({
        query: () => "albums/place/list/",
        transformResponse: response => PlacesAlbumsResponseSchema.parse(response).results,
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

export const { useFetchPlacesAlbumsQuery, useFetchLocationClustersQuery } = placesAlbumsApi;
