import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from "zod";

import { notification } from "../../service/notifications";
import { fetchClient, queryClient, QueryKeys } from "../tanstack-api";
import {
  UserAlbumListResponseSchema, 
  UserAlbumSchema,
  DeleteUserAlbumParams,
  RenameUserAlbumParams,
  CreateUserAlbumParams,
  RemovePhotoFromUserAlbumParams,
  AddPhotoFromUserAlbumParams,
  SetUserAlbumCoverParams
} from "./types";

// Fetch user albums
export const useFetchUserAlbumsQuery = () => useQuery({
  queryKey: [QueryKeys.userAlbums],
  queryFn: async () => {
    const response = await fetchClient.get('/albums/user/list/');
    return UserAlbumListResponseSchema.parse(response).results;
  },
});

// Fetch a single user album
export const useFetchUserAlbumQuery = (id: string) => useQuery({
  queryKey: [QueryKeys.userAlbum, id],
  queryFn: async () => {
    const response = await fetchClient.get(`/albums/user/${id}/`);
    return UserAlbumSchema.parse(response);
  },
});

// Delete user album mutation
export const useDeleteUserAlbumMutation = () => useMutation({
  mutationFn: async ({ id, albumTitle }: DeleteUserAlbumParams) => {
    await fetchClient.delete(`/albums/user/${id}/`);
    notification.deleteAlbum(albumTitle);
  },
  onSuccess: () => {
    // Invalidate relevant queries
    queryClient.invalidateQueries({ queryKey: [QueryKeys.userAlbums] });
  },
});

// Rename user album mutation
export const useRenameUserAlbumMutation = () => useMutation({
  mutationFn: async ({ id, title, newTitle }: RenameUserAlbumParams) => {
    await fetchClient.patch(`/albums/user/${id}/`, { title: newTitle });
    notification.renameAlbum(title, newTitle);
  },
  onSuccess: (_, { id }) => {
    // Invalidate relevant queries
    queryClient.invalidateQueries({ queryKey: [QueryKeys.userAlbums] });
    queryClient.invalidateQueries({ queryKey: [QueryKeys.userAlbum, id] });
  },
});

// Create user album mutation
export const useCreateUserAlbumMutation = () => useMutation({
  mutationFn: async ({ title, photos }: CreateUserAlbumParams) => {
    await fetchClient.post(`/albums/user/edit/`, { title, photos });
    notification.createAlbum(title, photos.length);
  },
  onSuccess: () => {
    // Invalidate relevant queries
    queryClient.invalidateQueries({ queryKey: [QueryKeys.userAlbums] });
  },
});

// Remove photo from user album mutation
export const useRemovePhotoFromUserAlbumMutation = () => useMutation({
  mutationFn: async ({ id, title, photos }: RemovePhotoFromUserAlbumParams) => {
    await fetchClient.patch(`/albums/user/edit/${id}/`, { removedPhotos: photos });
    notification.removePhotosFromAlbum(title, photos.length);
  },
  onSuccess: (_, { id }) => {
    // Invalidate relevant queries
    queryClient.invalidateQueries({ queryKey: [QueryKeys.userAlbums] });
    queryClient.invalidateQueries({ queryKey: [QueryKeys.userAlbum, id] });
  },
});

// Set user album cover mutation
export const useSetUserAlbumCoverMutation = () => useMutation({
  mutationFn: async ({ id, photo }: SetUserAlbumCoverParams) => {
    await fetchClient.patch(`/albums/user/edit/${id}/`, { cover_photo: photo });
    notification.setCoverPhoto();
  },
  onSuccess: () => {
    // Invalidate relevant queries
    queryClient.invalidateQueries({ queryKey: [QueryKeys.userAlbums] });
  },
});

// Add photo to user album mutation
export const useAddPhotoToUserAlbumMutation = () => useMutation({
  mutationFn: async ({ id, title, photos }: AddPhotoFromUserAlbumParams) => {
    await fetchClient.patch(`/albums/user/edit/${id}/`, { title, photos });
    notification.addPhotosToAlbum(title, photos.length);
  },
  onSuccess: (_, { id }) => {
    // Invalidate relevant queries
    queryClient.invalidateQueries({ queryKey: [QueryKeys.userAlbums] });
    queryClient.invalidateQueries({ queryKey: [QueryKeys.userAlbum, id] });
  },
}); 