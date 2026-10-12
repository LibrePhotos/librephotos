import { useMutation } from "@tanstack/react-query";
import { notification } from "../../../service/notifications";
import { albumKeys } from "../../albums/keys";
import { apiClient, queryClient } from "../../api";
import { startJob } from "../startJob";

export const useGenerateAutoAlbumsMutation = () =>
  useMutation({
    mutationFn: async () => {
      const start = await startJob(() => apiClient.post("/autoalbumgen/", {}));
      if (!start.alreadyRunning) {
        notification.generateEventAlbums();
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: albumKeys.autoAlbums() });
    },
  });
