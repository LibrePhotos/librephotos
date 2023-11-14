import { showNotification } from "@mantine/notifications";
import { z } from "zod";

import { AutoAlbumSchema } from "../../actions/albumActions.types";
import { PhotoHashSchema } from "../../actions/photosActions.types";
import i18n from "../../i18n";
import { api } from "../api";

export const AutoAlbumListSchema = z
  .object({
    id: z.number(),
    title: z.string(),
    timestamp: z.string(),
    photos: PhotoHashSchema, // TODO: This is a single photo, so the property name should be corrected. Perhaps cover_photo?
    photo_count: z.number(),
    favorited: z.boolean(),
  })
  .array();

export const AutoAlbumListResponseSchema = z.object({
  results: AutoAlbumListSchema,
});

type AutoAlbumList = z.infer<typeof AutoAlbumListSchema>;
type AutoAlbum = z.infer<typeof AutoAlbumSchema>;

enum Endpoints {
  fetchAutoAlbums = "fetchAutoAlbums",
  fetchAutoAlbum = "fetchAutoAlbum",
  deleteAutoAlbum = "deleteAutoAlbum",
  deleteAllAutoAlbums = "deleteAllAutoAlbums",
  generateAutoAlbums = "generateAutoAlbums",
}

export const autoAlbumsApi = api
  .injectEndpoints({
    endpoints: builder => ({
      [Endpoints.fetchAutoAlbums]: builder.query<AutoAlbumList, void>({
        query: () => "albums/auto/list/",
        transformResponse: response => AutoAlbumListResponseSchema.parse(response).results,
      }),
      [Endpoints.fetchAutoAlbum]: builder.query<AutoAlbum, string>({
        query: id => `albums/auto/${id}/`,
        transformResponse: response => AutoAlbumSchema.parse(response),
      }),
      [Endpoints.deleteAutoAlbum]: builder.mutation<void, { id: string; albumTitle: string }>({
        query: ({ id }) => ({
          url: `albums/auto/${id}/`,
          method: "DELETE",
          body: {},
        }),
        transformResponse: (response, meta, query) => {
          showNotification({
            message: i18n.t("toasts.deletealbum", query),
            title: i18n.t("toasts.deletealbumtitle"),
            color: "teal",
          });
        },
      }),
      [Endpoints.deleteAllAutoAlbums]: builder.mutation<void, void>({
        query: () => ({
          url: `albums/auto/delete_all/`,
          method: "POST",
          body: {},
        }),
        transformResponse: () => {
          showNotification({
            message: i18n.t("toasts.deleteallautoalbums"),
            title: i18n.t("toasts.deleteallautoalbumstitle"),
            color: "teal",
          });
        },
      }),
      [Endpoints.generateAutoAlbums]: builder.mutation<void, void>({
        query: () => ({
          url: `autoalbumgen/`,
          method: "POST",
          body: {},
        }),
        transformResponse: () => {
          showNotification({
            message: i18n.t("toasts.generateeventalbums"),
            title: i18n.t("toasts.generateeventalbumstitle"),
            color: "teal",
          });
        },
      }),
    }),
  })
  .enhanceEndpoints<"AutoAlbums" | "AutoAlbum">({
    addTagTypes: ["AutoAlbums", "AutoAlbum"],
    endpoints: {
      [Endpoints.fetchAutoAlbums]: {
        providesTags: ["AutoAlbums"],
      },
      [Endpoints.fetchAutoAlbum]: {
        providesTags: ["AutoAlbum"],
      },
      [Endpoints.deleteAutoAlbum]: {
        invalidatesTags: ["AutoAlbums", "AutoAlbum"],
      },
      [Endpoints.deleteAllAutoAlbums]: {
        invalidatesTags: ["AutoAlbums", "AutoAlbum"],
      },
      [Endpoints.generateAutoAlbums]: {
        invalidatesTags: ["AutoAlbums", "AutoAlbum"],
      },
    },
  });

export const {
  useFetchAutoAlbumsQuery,
  useLazyFetchAutoAlbumQuery,
  useDeleteAutoAlbumMutation,
  useDeleteAllAutoAlbumsMutation,
  useGenerateAutoAlbumsMutation,
} = autoAlbumsApi;
