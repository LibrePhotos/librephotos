import { endpoints, type CreateUserAlbumResponse } from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient } from "../../api";
import { mutationErrorMeta, type MutationErrorOptions } from "../../mutationErrors";
import { invalidateUserAlbumPhotos } from "../invalidateUserAlbumPhotos";
import type { CreateUserAlbumParams } from "../types";

/** Creates an album, with photos or empty (to fill by uploading, #612); answers the new album. */
export const useCreateUserAlbumMutation = (options: MutationErrorOptions = {}) => {
  const queryClient = useQueryClient();
  return useMutation({
    meta: mutationErrorMeta(options),
    mutationFn: async ({
      title,
      photos,
      select_all,
      query,
      excluded_hashes,
      photoCount,
    }: CreateUserAlbumParams): Promise<CreateUserAlbumResponse> => {
      const selectAll = select_all ? { query, excludedHashes: excluded_hashes } : undefined;
      const album = await endpoints.createUserAlbum(apiClient, title, photos, selectAll);
      // An empty album opens right away; "0 photos were added" would say nothing.
      if (selectAll || photos.length > 0) notification.createAlbum(title, photoCount ?? photos.length);
      return album;
    },
    onSuccess: () => invalidateUserAlbumPhotos(queryClient),
  });
};
