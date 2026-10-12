import { useMutation } from "@tanstack/react-query";
import { apiClient, queryClient } from "../../api";
import { photoGridKeys } from "../../photos/keys";
import { albumKeys } from "../keys";
import type { ToggleUserAlbumLockedParams } from "../types";

export const useToggleUserAlbumLockedMutation = () =>
  useMutation({
    mutationFn: async ({ id, locked }: ToggleUserAlbumLockedParams) => {
      await apiClient.patch(`/albums/user/edit/${id}/`, { locked });
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: albumKeys.userAlbums() });
      queryClient.invalidateQueries({ queryKey: photoGridKeys.userAlbum(id) });
    },
  });
