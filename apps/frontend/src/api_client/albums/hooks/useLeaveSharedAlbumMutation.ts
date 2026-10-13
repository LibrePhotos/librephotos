import { albumKeys, endpoints, photoGridKeys } from "@librephotos/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { apiClient } from "../../api";

type LeaveSharedAlbumParams = {
  id: string;
  title: string;
};

/**
 * Leave an album someone shared with you (#2210): it drops off "Shared with me". Only you leave;
 * the owner and the other people it is shared with keep it.
 */
export const useLeaveSharedAlbumMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: LeaveSharedAlbumParams) => endpoints.leaveSharedAlbum(apiClient, id),
    onSuccess: (_, { id, title }) => {
      notification.leaveAlbum(title);
      // The album page navigates away: refetching it now would flash "Album not found" first.
      void queryClient.invalidateQueries({ queryKey: photoGridKeys.userAlbum(id), refetchType: "none" });
      return queryClient.invalidateQueries({ queryKey: albumKeys.sharedWithMe() });
    },
  });
};
