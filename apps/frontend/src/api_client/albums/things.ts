import { z } from "zod";

import { DatePhotosGroupSchema, PhotoHashSchema } from "../../actions/photosActions.types";
import { api } from "../api";

const ThingsAlbumListSchema = z
  .object({
    id: z.number(),
    title: z.string(),
    cover_photos: PhotoHashSchema.array(),
    photo_count: z.number(),
  })
  .array();

const ThingsAlbumSchema = z.object({
  id: z.string(),
  title: z.string(),
  grouped_photos: DatePhotosGroupSchema.array(),
});

const ThingsAlbumResponseSchema = z.object({
  results: ThingsAlbumSchema,
});

type ThingsAlbumList = z.infer<typeof ThingsAlbumListSchema>;
type ThingsAlbum = z.infer<typeof ThingsAlbumSchema>;

enum Endpoints {
  fetchThingsAlbums = "fetchThingsAlbums",
  fetchThingsAlbum = "fetchThingsAlbum",
}

const thingsAlbumsApi = api
  .injectEndpoints({
    endpoints: builder => ({
      [Endpoints.fetchThingsAlbums]: builder.query<ThingsAlbumList, void>({
        query: () => "albums/thing/list/",
        transformResponse: response => ThingsAlbumListSchema.parse(response),
      }),
      [Endpoints.fetchThingsAlbum]: builder.query<ThingsAlbum, string>({
        query: id => `albums/thing/${id}/`,
        transformResponse: response => ThingsAlbumResponseSchema.parse(response).results,
      }),
    }),
  })
  .enhanceEndpoints<"ThingsAlbums" | "ThingsAlbum">({
    addTagTypes: ["ThingsAlbums", "ThingsAlbum"],
    endpoints: {
      [Endpoints.fetchThingsAlbums]: {
        providesTags: ["ThingsAlbums"],
      },
      [Endpoints.fetchThingsAlbum]: {
        providesTags: ["ThingsAlbum"],
      },
    },
  });

export const { useLazyFetchThingsAlbumQuery } = thingsAlbumsApi;
