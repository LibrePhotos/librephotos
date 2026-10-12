import { endpoints } from "@librephotos/api-client";
import { useMutation } from "@tanstack/react-query";
import { apiClient, queryClient } from "../../api";
import { photoGridKeys } from "../../photos/keys";
import { albumKeys } from "../keys";
import type { ToggleUserAlbumLockedParams } from "../types";

export const useToggleUserAlbumLockedMutation = () =>
  useMutation({
    mutationFn: async ({ id, locked }: ToggleUserAlbumLockedParams) => {
      await endpoints.setUserAlbumLocked(apiClient, id, locked);
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: albumKeys.userAlbums() });
      queryClient.invalidateQueries({ queryKey: photoGridKeys.userAlbum(id) });
    },
  });
