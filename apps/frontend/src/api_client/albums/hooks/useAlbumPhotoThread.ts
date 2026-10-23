import { albumKeys, endpoints } from "@librephotos/api-client";
import type { AlbumLikes } from "@librephotos/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api";

// Comments and likes on a photo in a shared album (#262). A thread belongs to the photo in one
// album; the server answers 404 for anyone outside the album.

export const useAlbumPhotoCommentsQuery = (albumId: string, photoId: string) =>
  useQuery({
    queryKey: albumKeys.photoComments(albumId, photoId),
    queryFn: () => endpoints.fetchAlbumPhotoComments(apiClient, albumId, photoId),
  });

export const useAlbumPhotoLikesQuery = (albumId: string, photoId: string) =>
  useQuery({
    queryKey: albumKeys.photoLikes(albumId, photoId),
    queryFn: () => endpoints.fetchAlbumPhotoLikes(apiClient, albumId, photoId),
  });

type ThreadParams = { albumId: string; photoId: string };

/** Comment, edit or delete; the thread refetches after each. */
export const useAlbumCommentMutations = ({ albumId, photoId }: ThreadParams) => {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: albumKeys.photoComments(albumId, photoId) });
  const add = useMutation({
    mutationFn: (text: string) => endpoints.addAlbumPhotoComment(apiClient, albumId, photoId, text),
    onSuccess: refresh,
  });
  const edit = useMutation({
    mutationFn: ({ commentId, text }: { commentId: number; text: string }) =>
      endpoints.editAlbumPhotoComment(apiClient, albumId, photoId, commentId, text),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (commentId: number) => endpoints.deleteAlbumPhotoComment(apiClient, albumId, photoId, commentId),
    onSuccess: refresh,
  });
  return { add, edit, remove };
};

/** Heart or un-heart; the answer is the hearts after the change. */
export const useSetAlbumPhotoLikedMutation = ({ albumId, photoId }: ThreadParams) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (liked: boolean) => endpoints.setAlbumPhotoLiked(apiClient, albumId, photoId, liked),
    onSuccess: (likes: AlbumLikes) => {
      queryClient.setQueryData(albumKeys.photoLikes(albumId, photoId), likes);
    },
  });
};
