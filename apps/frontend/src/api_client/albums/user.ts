import { showNotification } from "@mantine/notifications";
import { z } from "zod";

import { PhotoSuperSimpleSchema } from "../../actions/albumActions.types";
import { DatePhotosGroupSchema, SimpleUserSchema } from "../../actions/photosActions.types";
import i18n from "../../i18n";
import { api } from "../api";

const UserAlbumResponseSchema = z.object({
  id: z.number(),
  title: z.string(),
  cover_photo: PhotoSuperSimpleSchema,
  photo_count: z.number(),
  owner: SimpleUserSchema,
  shared_to: SimpleUserSchema.array(),
  created_on: z.string(),
  favorited: z.boolean(),
});

const UserAlbumListSchema = UserAlbumResponseSchema.array();

const UserAlbumListResponseSchema = z.object({
  results: UserAlbumListSchema,
});

export type UserAlbumList = z.infer<typeof UserAlbumListSchema>;

const UserAlbumSchema = z.object({
  id: z.string(),
  title: z.string(),
  owner: SimpleUserSchema,
  shared_to: SimpleUserSchema.array(),
  date: z.string(),
  location: z.string().nullable(),
  grouped_photos: DatePhotosGroupSchema.array(),
});

export type UserAlbum = z.infer<typeof UserAlbumSchema>;

enum Endpoints {
  fetchUserAlbums = "fetchUserAlbums",
  fetchUserAlbum = "fetchUserAlbum",
  createUserAlbum = "createUserAlbum",
  renameUserAlbum = "renameUserAlbum",
  deleteUserAlbum = "deleteUserAlbum",
  removePhotoFromUserAlbum = "removePhotoFromUserAlbum",
  addPhotoToUserAlbum = "addPhotoToUserAlbum",
  setUserAlbumCover = "setUserAlbumCover",
  shareUserAlbum = "shareUserAlbum",
}

type DeleteUserAlbumParams = {
  id: string;
  albumTitle: string;
};

type RenameUserAlbumParams = {
  id: string;
  title: string;
  newTitle: string;
};

type CreateUserAlbumParams = {
  title: string;
  photos: string[];
};

type RemovePhotoFromUserAlbumParams = {
  id: string;
  title: string;
  photos: string[];
};

type AddPhotoFromUserAlbumParams = {
  id: string;
  title: string;
  photos: string[];
};

type SetUserAlbumCoverParams = {
  id: string;
  photo: string;
};

type ShareUserAlbumParams = {
  albumId: string;
  userId: string;
  share: boolean;
};

export const userAlbumsApi = api
  .injectEndpoints({
    endpoints: builder => ({
      [Endpoints.fetchUserAlbums]: builder.query<UserAlbumList, void>({
        query: () => "albums/user/list/",
        transformResponse: response => UserAlbumListResponseSchema.parse(response).results,
      }),
      [Endpoints.fetchUserAlbum]: builder.query<UserAlbum, string>({
        query: id => `albums/user/${id}/`,
        transformResponse: response => UserAlbumSchema.parse(response),
      }),
      [Endpoints.deleteUserAlbum]: builder.mutation<void, DeleteUserAlbumParams>({
        query: ({ id }) => ({
          url: `albums/user/${id}/`,
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
      [Endpoints.renameUserAlbum]: builder.mutation<void, RenameUserAlbumParams>({
        query: ({ id, newTitle }) => ({
          url: `albums/user/${id}/`,
          method: "PATCH",
          body: { title: newTitle },
        }),
        transformResponse: (response, meta, query) => {
          showNotification({
            message: i18n.t("toasts.renamealbum", {
              oldTitle: query.title,
              newTitle: query.newTitle,
            }),
            title: i18n.t("toasts.renamealbumtitle"),
            color: "teal",
          });
        },
      }),
      [Endpoints.createUserAlbum]: builder.mutation<void, CreateUserAlbumParams>({
        query: ({ title, photos }) => ({
          url: `albums/user/edit/`,
          method: "POST",
          body: { title, photos },
        }),
        transformResponse: (response, meta, query) => {
          showNotification({
            message: i18n.t("toasts.createnewalbum", {
              title: query.title,
              numberOfPhotos: query.photos.length,
            }),
            title: i18n.t("toasts.createalbumtitle"),
            color: "teal",
          });
        },
      }),
      [Endpoints.removePhotoFromUserAlbum]: builder.mutation<void, RemovePhotoFromUserAlbumParams>({
        query: ({ id, photos }) => ({
          url: `albums/user/edit/${id}/`,
          method: "PATCH",
          body: { removedPhotos: photos },
        }),
        transformResponse: (response, meta, query) => {
          showNotification({
            message: i18n.t("toasts.removefromalbum", {
              title: query.title,
              numberOfPhotos: query.photos.length,
            }),
            title: i18n.t("toasts.removefromalbumtitle"),
            color: "teal",
          });
        },
      }),
      [Endpoints.setUserAlbumCover]: builder.mutation<void, SetUserAlbumCoverParams>({
        query: ({ id, photo }) => ({
          url: `albums/user/edit/${id}/`,
          method: "PATCH",
          body: { cover_photo: photo },
        }),
        transformResponse: () => {
          showNotification({
            message: i18n.t("toasts.setcoverphoto"),
            title: i18n.t("toasts.setcoverphototitle"),
            color: "teal",
          });
        },
      }),
      [Endpoints.addPhotoToUserAlbum]: builder.mutation<void, AddPhotoFromUserAlbumParams>({
        query: ({ id, title, photos }) => ({
          url: `albums/user/edit/${id}/`,
          method: "PATCH",
          body: { title, photos },
        }),
        transformResponse: (response, meta, query) => {
          showNotification({
            message: i18n.t("toasts.addtoalbum", {
              title: query.title,
              numberOfPhotos: query.photos.length,
            }),
            title: i18n.t("toasts.addtoalbumtitle"),
            color: "teal",
          });
        },
      }),
      [Endpoints.shareUserAlbum]: builder.mutation<void, ShareUserAlbumParams>({
        query: ({ albumId, userId, share }) => ({
          url: `useralbum/share/`,
          method: "POST",
          body: { shared: share, album_id: albumId, target_user_id: userId },
        }),
        transformResponse: (response, meta, query) => {
          if (query.share) {
            showNotification({
              message: i18n.t("toasts.sharingalbum"),
              title: i18n.t("toasts.sharingalbumtitle"),
              color: "teal",
            });
          } else {
            showNotification({
              message: i18n.t("toasts.unsharingalbum"),
              title: i18n.t("toasts.unsharingalbumtitle"),
              color: "teal",
            });
          }
        },
      }),
    }),
  })
  .enhanceEndpoints<"UserAlbums" | "UserAlbum">({
    addTagTypes: ["UserAlbums", "UserAlbum"],
    endpoints: {
      [Endpoints.fetchUserAlbums]: {
        providesTags: ["UserAlbums"],
      },
      [Endpoints.fetchUserAlbum]: {
        providesTags: ["UserAlbum"],
      },
      [Endpoints.deleteUserAlbum]: {
        invalidatesTags: ["UserAlbums"],
      },
      [Endpoints.renameUserAlbum]: {
        invalidatesTags: ["UserAlbums", "UserAlbum"],
      },
      [Endpoints.createUserAlbum]: {
        invalidatesTags: ["UserAlbums"],
      },
      [Endpoints.removePhotoFromUserAlbum]: {
        invalidatesTags: ["UserAlbums", "UserAlbum"],
      },
      [Endpoints.setUserAlbumCover]: {
        invalidatesTags: ["UserAlbums"],
      },
      [Endpoints.addPhotoToUserAlbum]: {
        invalidatesTags: ["UserAlbums", "UserAlbum"],
      },
      [Endpoints.shareUserAlbum]: {
        // TODO(sickelap): invalidate only the album that was shared
        invalidatesTags: ["UserAlbums", "UserAlbum"],
      },
    },
  });

export const {
  useFetchUserAlbumsQuery,
  useFetchUserAlbumQuery,
  useLazyFetchUserAlbumQuery,
  useDeleteUserAlbumMutation,
  useRenameUserAlbumMutation,
  useCreateUserAlbumMutation,
  useRemovePhotoFromUserAlbumMutation,
  useSetUserAlbumCoverMutation,
  useAddPhotoToUserAlbumMutation,
  useShareUserAlbumMutation,
} = userAlbumsApi;
