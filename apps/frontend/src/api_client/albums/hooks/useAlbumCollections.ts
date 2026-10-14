import { albumKeys, endpoints } from "@librephotos/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient } from "../../api";
import { mutationErrorMeta, type MutationErrorOptions } from "../../mutationErrors";

/** The user's album collections (#1009), by name. */
export const useFetchAlbumCollectionsQuery = () =>
  useQuery({
    queryKey: albumKeys.albumCollections(),
    queryFn: () => endpoints.fetchAlbumCollections(apiClient),
  });

/** Create a collection; answers it, so a caller can file an album in it right away. */
export const useCreateAlbumCollectionMutation = (options: MutationErrorOptions = {}) => {
  const queryClient = useQueryClient();
  return useMutation({
    meta: mutationErrorMeta(options),
    mutationFn: (name: string) => endpoints.createAlbumCollection(apiClient, name),
    onSuccess: ({ name }) => {
      notification.createAlbumCollection(name);
      return queryClient.invalidateQueries({ queryKey: albumKeys.albumCollections() });
    },
  });
};

type RenameAlbumCollectionParams = { id: number; name: string; newName: string };

export const useRenameAlbumCollectionMutation = (options: MutationErrorOptions = {}) => {
  const queryClient = useQueryClient();
  return useMutation({
    meta: mutationErrorMeta(options),
    mutationFn: ({ id, newName }: RenameAlbumCollectionParams) =>
      endpoints.renameAlbumCollection(apiClient, id, newName),
    onSuccess: (_, { name, newName }) => {
      notification.renameAlbumCollection(name, newName);
      return queryClient.invalidateQueries({ queryKey: albumKeys.albumCollections() });
    },
  });
};

type DeleteAlbumCollectionParams = { id: number; name: string };

/** Delete a collection; its albums stay, so the album cards lose its id. */
export const useDeleteAlbumCollectionMutation = (options: MutationErrorOptions = {}) => {
  const queryClient = useQueryClient();
  return useMutation({
    meta: mutationErrorMeta(options),
    mutationFn: ({ id }: DeleteAlbumCollectionParams) => endpoints.deleteAlbumCollection(apiClient, id),
    onSuccess: (_, { name }) => {
      notification.deleteAlbumCollection(name);
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: albumKeys.albumCollections() }),
        queryClient.invalidateQueries({ queryKey: albumKeys.userAlbums() }),
      ]);
    },
  });
};

type SetUserAlbumCollectionsParams = { albumId: number | string; collectionIds: number[] };

/** Put an album in exactly these collections; the My Albums cards carry the ids. */
export const useSetUserAlbumCollectionsMutation = (options: MutationErrorOptions = {}) => {
  const queryClient = useQueryClient();
  return useMutation({
    meta: mutationErrorMeta(options),
    mutationFn: ({ albumId, collectionIds }: SetUserAlbumCollectionsParams) =>
      endpoints.setUserAlbumCollections(apiClient, albumId, collectionIds),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: albumKeys.userAlbums() }),
  });
};
