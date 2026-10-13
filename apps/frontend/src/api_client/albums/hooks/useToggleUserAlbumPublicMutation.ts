import { albumKeys, endpoints, photoGridKeys, type PublicSharingOptions } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { apiClient, queryClient } from "../../api";
import { mutationErrorMeta, type MutationErrorOptions } from "../../mutationErrors";

type ToggleUserAlbumPublicParams = {
  albumId: string;
  public: boolean;
  slug?: string;
  expires_at?: string | null; // ISO
  sharing_options?: PublicSharingOptions;
};

export const useToggleUserAlbumPublicMutation = (options: MutationErrorOptions = {}) =>
  useMutation({
    meta: mutationErrorMeta(options),
    mutationFn: async ({
      albumId,
      public: isPublic,
      slug,
      expires_at,
      sharing_options,
    }: ToggleUserAlbumPublicParams) => {
      await endpoints.setUserAlbumPublic(apiClient, {
        albumId,
        isPublic,
        slug,
        expiresAt: expires_at,
        sharingOptions: sharing_options,
      });
    },
    onSuccess: (_, { albumId }) => {
      queryClient.invalidateQueries({ queryKey: albumKeys.userAlbums() });
      queryClient.invalidateQueries({ queryKey: photoGridKeys.userAlbum(albumId) });
    },
  });
