import { notification } from "../../service/notifications";
import { api } from "../api";
import type {
  AddPhotoFromUserAlbumParams,
  CreateUserAlbumParams,
  DeleteUserAlbumParams,
  RemovePhotoFromUserAlbumParams,
  RenameUserAlbumParams,
  SetUserAlbumCoverParams,
  UserAlbum,
  UserAlbumList,
} from "./types";
import { UserAlbumListResponseSchema, UserAlbumSchema } from "./types";

enum Endpoints {
  fetchUserAlbums = "fetchUserAlbums",
  fetchUserAlbum = "fetchUserAlbum",
  createUserAlbum = "createUserAlbum",
  renameUserAlbum = "renameUserAlbum",
  deleteUserAlbum = "deleteUserAlbum",
  removePhotoFromUserAlbum = "removePhotoFromUserAlbum",
  addPhotoToUserAlbum = "addPhotoToUserAlbum",
  setUserAlbumCover = "setUserAlbumCover",
}

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
          notification.deleteAlbum(query.albumTitle);
        },
      }),
      [Endpoints.renameUserAlbum]: builder.mutation<void, RenameUserAlbumParams>({
        query: ({ id, newTitle }) => ({
          url: `albums/user/${id}/`,
          method: "PATCH",
          body: { title: newTitle },
        }),
        transformResponse: (response, meta, query) => {
          notification.renameAlbum(query.title, query.newTitle);
        },
      }),
      [Endpoints.createUserAlbum]: builder.mutation<void, CreateUserAlbumParams>({
        query: ({ title, photos }) => ({
          url: `albums/user/edit/`,
          method: "POST",
          body: { title, photos },
        }),
        transformResponse: (response, meta, query) => {
          notification.createAlbum(query.title, query.photos.length);
        },
      }),
      [Endpoints.removePhotoFromUserAlbum]: builder.mutation<void, RemovePhotoFromUserAlbumParams>({
        query: ({ id, photos }) => ({
          url: `albums/user/edit/${id}/`,
          method: "PATCH",
          body: { removedPhotos: photos },
        }),
        transformResponse: (response, meta, query) => {
          notification.removePhotosFromAlbum(query.title, query.photos.length);
        },
      }),
      [Endpoints.setUserAlbumCover]: builder.mutation<void, SetUserAlbumCoverParams>({
        query: ({ id, photo }) => ({
          url: `albums/user/edit/${id}/`,
          method: "PATCH",
          body: { cover_photo: photo },
        }),
        transformResponse: () => {
          notification.setCoverPhoto();
        },
      }),
      [Endpoints.addPhotoToUserAlbum]: builder.mutation<void, AddPhotoFromUserAlbumParams>({
        query: ({ id, title, photos }) => ({
          url: `albums/user/edit/${id}/`,
          method: "PATCH",
          body: { title, photos },
        }),
        transformResponse: (response, meta, query) => {
          notification.addPhotosToAlbum(query.title, query.photos.length);
        },
      }),
    }),
  })
  .enhanceEndpoints<"UserAlbums" | "UserAlbum" | "SharedAlbumsByMe" | "SharedAlbumsWithMe">({
    addTagTypes: ["UserAlbums", "UserAlbum", "SharedAlbumsByMe", "SharedAlbumsWithMe"],
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
} = userAlbumsApi;
