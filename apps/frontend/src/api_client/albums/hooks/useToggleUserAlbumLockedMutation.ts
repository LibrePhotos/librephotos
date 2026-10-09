import { useMutation } from "@tanstack/react-query";
import { fetchClient, queryClient } from "../../api";
import type { ToggleUserAlbumLockedParams } from "../types";
import { UserAlbumQueryKeys } from "./useFetchUserAlbumQuery";
import { UserAlbumsQueryKeys } from "./useFetchUserAlbumsQuery";

export const useToggleUserAlbumLockedMutation = () =>
  useMutation({
    mutationFn: async ({ id, locked }: ToggleUserAlbumLockedParams) => {
      await fetchClient.patch(`/albums/user/edit/${id}/`, { locked });
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: [...UserAlbumsQueryKeys] });
      queryClient.invalidateQueries({ queryKey: [...UserAlbumQueryKeys, id] });
    },
  });
