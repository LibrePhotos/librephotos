import { albumKeys, endpoints, photoGridKeys } from "@librephotos/api-client";
import type { AlbumMemberCeiling, AlbumMemberSwitches, BulkPhotoQuery } from "@librephotos/api-client";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient } from "../../api";

// Collaborative albums (#464): a contributor adds and removes their own photos, every member sets
// what the others see of the photos they add, and the owner sets what members may see at all.

function refreshAlbum(queryClient: QueryClient, albumId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: photoGridKeys.userAlbum(albumId) }),
    queryClient.invalidateQueries({ queryKey: albumKeys.sharedWithMe() }),
    queryClient.invalidateQueries({ queryKey: albumKeys.userAlbums() }),
  ]);
}

type AddPhotosParams = {
  albumId: string;
  title: string;
  photoIds: string[];
  /** Select-all: the query the view shows and the photos unticked in it. */
  selectAll?: { query: BulkPhotoQuery; excludedHashes: string[] };
};

/** Add photos of your own to an album you contribute to; they stay yours. */
export const useAddPhotosToSharedAlbumMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ albumId, photoIds, selectAll }: AddPhotosParams) =>
      endpoints.addPhotosToAlbum(apiClient, albumId, photoIds, selectAll),
    onSuccess: ({ count }, { albumId, title }) => {
      notification.addPhotosToAlbum(title, count);
      return refreshAlbum(queryClient, albumId);
    },
  });
};

type RemovePhotosParams = { albumId: string; title: string; photoIds: string[] };

/** Take the photos you added out of an album shared with you; they stay in your library. */
export const useRemovePhotosFromSharedAlbumMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ albumId, photoIds }: RemovePhotosParams) =>
      endpoints.removePhotosFromAlbum(apiClient, albumId, photoIds),
    onSuccess: ({ count }, { albumId, title }) => {
      notification.removePhotosFromAlbum(title, count);
      return refreshAlbum(queryClient, albumId);
    },
  });
};

type MembershipParams = { albumId: string; switches: Partial<AlbumMemberSwitches> };

/** Your own switches in an album shared with you: what others see of the photos you add. */
export const useSetAlbumMembershipMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ albumId, switches }: MembershipParams) => endpoints.setAlbumMembership(apiClient, albumId, switches),
    onSuccess: (_, { albumId }) => refreshAlbum(queryClient, albumId),
  });
};

type CeilingParams = { albumId: string; ceiling: AlbumMemberCeiling };

/** The owner's ceiling: what members may see of the album's photos. */
export const useSetAlbumMemberCeilingMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ albumId, ceiling }: CeilingParams) => endpoints.setAlbumMemberCeiling(apiClient, albumId, ceiling),
    onSuccess: (_, { albumId }) => refreshAlbum(queryClient, albumId),
  });
};
